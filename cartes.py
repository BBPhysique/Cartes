"""
Extrait les flashcards recto-verso d'un PDF en images WebP et crée leur manifest.json.

Exemples :
    python cartes.py
    python cartes.py --profile lossless
    python cartes.py --search-dir /chemin/vers/mes_pdfs --profile fast

Dépendances :
    pip install pymupdf pillow numpy scipy
"""

import argparse
import colorsys
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pymupdf
from PIL import Image, ImageOps
from scipy import ndimage

# Une bordure plus claire est de l'anti-crénelage, pas le contour solide de la carte.
# Ce plafond permet donc de retrouver proprement la forme, quelle que soit la couleur.
MAX_OUTLINE_LUMINANCE = 210
EDGE_ANTIALIAS_WIDTH_PX = 2
WHITE_THRESHOLD = 220

# Ces positions appartiennent au gabarit des flashcards, pas à l'utilisateur.
BORDER_OFFSET_PX = 6
BORDER_BAND_PX = 6
TIMER_X = 1100
TIMER_Y = 725
TIMER_REFERENCE_WIDTH = 1177
TIMER_REFERENCE_HEIGHT = 813
TIMER_SAMPLE_RADIUS = 12


@dataclass(frozen=True)
class ProcessingProfile:
    """Regroupe uniquement les compromis de sortie qui ont un sens pour l'utilisateur."""

    label: str
    dpi: int
    webp_quality: int = 88
    alpha_quality: int = 90
    webp_method: int = 6
    lossless: bool = False


PROFILES = {
    # Bon compromis poids/qualité pour le site : c'est le mode recommandé.
    "web": ProcessingProfile(
        label="Web — recommandé, bon équilibre entre qualité et poids", dpi=300
    ),
    # Même définition, mais sans aucune perte de compression.
    "lossless": ProcessingProfile(
        label="Sans perte — qualité maximale pour l'archivage",
        dpi=300,
        alpha_quality=100,
        lossless=True,
    ),
    # Rendu deux fois moins large et encodage plus rapide pour contrôler un PDF.
    "fast": ProcessingProfile(
        label="Rapide — aperçu plus léger à générer",
        dpi=150,
        webp_quality=82,
        alpha_quality=80,
        webp_method=3,
    ),
}


def fail(message: str, code: int = 1):
    print(f"ERREUR : {message}", file=sys.stderr)
    sys.exit(code)


def render_page_to_image(page: pymupdf.Page, dpi: int = 300) -> Image.Image:
    """Effectue le rendu directement au DPI demandé, sans calcul manuel d'échelle."""
    pixmap = page.get_pixmap(dpi=dpi, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def to_rgb_white_bg(image: Image.Image) -> Image.Image:
    if image.mode == "RGB":
        return image
    if image.mode in ("RGBA", "LA"):
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[-1])
        return background
    return image.convert("RGB")


def crop_to_one_px_margin(image: Image.Image) -> Image.Image:
    image = to_rgb_white_bg(image)
    luminance = np.asarray(ImageOps.grayscale(image), dtype=np.uint8)

    nonwhite = luminance < WHITE_THRESHOLD
    coords = np.argwhere(nonwhite)
    if coords.size == 0:
        fail("La page semble vide : aucun contenu non blanc n'a été trouvé.")

    (top, left), (bottom, right) = coords.min(0), coords.max(0)
    content = image.crop((left, top, right + 1, bottom + 1))
    return ImageOps.expand(content, border=1, fill="white")


def split_halves(image: Image.Image) -> Tuple[Image.Image, Image.Image]:
    width, height = image.size
    middle = width // 2
    return (
        image.crop((0, 0, middle, height)),
        image.crop((middle, 0, width, height)),
    )


def split_rows(side_image: Image.Image) -> Tuple[Image.Image, ...]:
    width, height = side_image.size
    cuts = [round(row * height / 4) for row in range(5)]
    return tuple(
        side_image.crop((0, cuts[row], width, cuts[row + 1])) for row in range(4)
    )


def trim_white_edges_midlines(card_img: Image.Image) -> Image.Image:
    """Enlève les fines marges blanches en observant le centre de chaque côté."""
    image = to_rgb_white_bg(card_img)
    width, height = image.size
    luminance = np.asarray(ImageOps.grayscale(image), dtype=np.uint8)
    if height < 5 or width < 5:
        return image

    band_height = max(3, int(round(height * 0.10)))
    band_width = max(3, int(round(width * 0.10)))
    row_start = max(0, (height // 2) - (band_height // 2))
    row_end = min(height, row_start + band_height)
    column_start = max(0, (width // 2) - (band_width // 2))
    column_end = min(width, column_start + band_width)

    max_horizontal_trim = max(1, int(round(width * 0.08)))
    max_vertical_trim = max(1, int(round(height * 0.08)))

    # NumPy teste ici toutes les lignes et colonnes d'un coup : c'est plus lisible
    # et nettement moins coûteux que quatre boucles Python pixel par pixel.
    white_columns = (luminance[row_start:row_end, :] >= WHITE_THRESHOLD).mean(
        axis=0
    ) >= 0.98
    white_rows = (luminance[:, column_start:column_end] >= WHITE_THRESHOLD).mean(
        axis=1
    ) >= 0.98

    def count_leading_true(values: np.ndarray) -> int:
        first_false = np.flatnonzero(~values)
        return int(first_false[0]) if first_false.size else len(values)

    left_trim = count_leading_true(white_columns[:max_horizontal_trim])
    right_trim = count_leading_true(white_columns[-max_horizontal_trim:][::-1])
    top_trim = count_leading_true(white_rows[:max_vertical_trim])
    bottom_trim = count_leading_true(white_rows[-max_vertical_trim:][::-1])

    left = min(left_trim, width - 2)
    right = max(width - right_trim, left + 1)
    top = min(top_trim, height - 2)
    bottom = max(height - bottom_trim, top + 1)
    if left > 0 or top > 0 or right < width or bottom < height:
        image = image.crop((left, top, right, bottom))
    return image


def make_external_white_transparent(card_img: Image.Image) -> Image.Image:
    """
    Isole la forme de la carte puis rend son extérieur transparent.

    La plus grande composante par surface englobante est la bordure de la carte.
    SciPy referme ses micro-coupures et remplit son intérieur : les zones blanches
    utiles restent donc opaques. La frange anti-crénelée est ensuite décontaminée
    du blanc du PDF pour éviter le halo visible sur un fond sombre.
    """
    rgb_image = to_rgb_white_bg(card_img)
    rgb = np.asarray(rgb_image, dtype=np.uint8)

    luminance = np.asarray(ImageOps.grayscale(rgb_image), dtype=np.uint8)
    outline = luminance < MAX_OUTLINE_LUMINANCE
    outline = ndimage.binary_closing(outline, structure=np.ones((3, 3), dtype=bool))

    labels, label_count = ndimage.label(outline)
    if label_count == 0:
        fail("Impossible de détecter la bordure de la carte.")

    component_slices = ndimage.find_objects(labels)

    def bounding_area(label_id: int) -> int:
        rows, columns = component_slices[label_id - 1]
        return (rows.stop - rows.start) * (columns.stop - columns.start)

    # Le contour entoure presque toute l'image : sa boîte est donc la plus grande,
    # même lorsqu'une illustration intérieure contient davantage de pixels.
    card_label = max(range(1, label_count + 1), key=bounding_area)
    card_outline = labels == card_label
    card_mask = ndimage.binary_fill_holes(card_outline)
    antialias_ring = (
        ndimage.binary_dilation(
            card_mask,
            structure=np.ones((3, 3), dtype=bool),
            iterations=EDGE_ANTIALIAS_WIDTH_PX,
        )
        & ~card_mask
    )

    # Le blanc de fond est lu dans les coins au lieu d'être supposé parfaitement pur.
    corner_size = max(2, min(8, min(rgb.shape[:2]) // 4))
    corner_pixels = np.concatenate(
        (
            rgb[:corner_size, :corner_size].reshape(-1, 3),
            rgb[:corner_size, -corner_size:].reshape(-1, 3),
            rgb[-corner_size:, :corner_size].reshape(-1, 3),
            rgb[-corner_size:, -corner_size:].reshape(-1, 3),
        )
    )
    background_rgb = np.median(corner_pixels, axis=0).astype(np.float32)

    # C = alpha * bordure + (1 - alpha) * fond. Cette projection retrouve alpha
    # sur les trois canaux à la fois et reste stable malgré les arrondis du rendu PDF.
    # La bordure est un aplat : sa médiane donne une couleur bien plus stable que
    # chaque pixel anti-crénelé et évite un calcul de distance coûteux sur l'image.
    border_rgb = np.median(rgb[card_outline], axis=0).astype(np.float32)
    foreground_vector = background_rgb - border_rgb
    observed_vector = background_rgb - rgb.astype(np.float32)
    denominator = float(np.dot(foreground_vector, foreground_vector))
    numerator = np.einsum("ijk,k->ij", observed_vector, foreground_vector)
    edge_alpha = (
        numerator / denominator if denominator > 1.0 else np.zeros_like(numerator)
    )
    edge_alpha = np.clip(edge_alpha, 0.0, 1.0)

    alpha = np.zeros(card_mask.shape, dtype=np.float32)
    alpha[card_mask] = 1.0
    alpha[antialias_ring] = edge_alpha[antialias_ring]

    # Les pixels semi-transparents reprennent la vraie couleur voisine de la bordure.
    # Leur couleur ne contient ainsi plus de blanc prémélangé susceptible de faire un halo.
    cleaned_rgb = rgb.copy()
    visible_edge = antialias_ring & (edge_alpha > 0.0)
    cleaned_rgb[visible_edge] = border_rgb.astype(np.uint8)

    rgba = np.dstack((cleaned_rgb, np.rint(alpha * 255).astype(np.uint8)))
    return Image.fromarray(rgba, mode="RGBA")


# Détection des couleurs de bordure et de minuteur

ColorName = str

BORDER_CANDIDATES: Dict[ColorName, float] = {
    "red": 0.0,
    "orange": 30.0,
    "green": 120.0,
    "purple": 285.0,
}

TIMER_CANDIDATES: Dict[ColorName, float] = {
    "red": 0.0,
    "orange": 33.0,
    "yellow": 54.0,
    "green": 120.0,
}


def _hue_distance(a: float, b: float) -> float:
    distance = abs(a - b)
    return min(distance, 360.0 - distance)


def _rgb_to_hsv_deg(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
    red, green, blue = rgb
    hue, saturation, value = colorsys.rgb_to_hsv(
        red / 255.0, green / 255.0, blue / 255.0
    )
    return hue * 360.0, saturation, value


def _classify_hsv(
    hue: float,
    saturation: float,
    value: float,
    candidates: Dict[ColorName, float],
) -> ColorName:
    # Une teinte trop terne ou trop sombre ne peut pas être identifiée fiablement.
    if saturation < 0.15 or value < 0.15:
        return "unknown"
    name, reference_hue = min(
        candidates.items(), key=lambda candidate: _hue_distance(hue, candidate[1])
    )
    # La tolérance couvre les variations du rendu sans forcer une mauvaise couleur.
    if _hue_distance(hue, reference_hue) > 35.0:
        return "unknown"
    return name


def _median_rgb(pixels: np.ndarray) -> Optional[Tuple[int, int, int]]:
    if pixels.size == 0:
        return None
    # Le tableau contient une ligne RGB par pixel : (nombre de pixels, 3).
    red = int(np.median(pixels[:, 0]))
    green = int(np.median(pixels[:, 1]))
    blue = int(np.median(pixels[:, 2]))
    return (red, green, blue)


def sample_border_color(card_img: Image.Image) -> Optional[Tuple[int, int, int]]:
    """Échantillonne la couleur de la bordure en haut de la carte.

    Une petite bande verticale est plus fiable qu'un pixel isolé pour repérer
    les bordures fines ou peu saturées. Les pixels transparents sont ignorés.
    """
    if card_img.mode not in ("RGB", "RGBA"):
        image = card_img.convert("RGBA")
    else:
        image = card_img

    pixels = np.asarray(image, dtype=np.uint8)
    height, width = pixels.shape[:2]

    center_x = width // 2
    # On descend assez dans la carte pour couvrir aussi les bordures un peu épaisses.
    scan_depth = min(height, max(BORDER_OFFSET_PX + BORDER_BAND_PX, 24))
    x0 = max(0, center_x - 2)
    x1 = min(width, center_x + 3)
    region = pixels[:scan_depth, x0:x1, :]

    if image.mode == "RGBA":
        alpha = region[:, :, 3].astype(np.uint16)
        alpha_mask = alpha >= 200
        rgb_region = region[:, :, :3]
    else:
        alpha_mask = np.ones(region.shape[:2], dtype=bool)
        rgb_region = region

    # Une approximation de la saturation suffit pour écarter le blanc et le gris.
    red = rgb_region[:, :, 0].astype(np.float32)
    green = rgb_region[:, :, 1].astype(np.float32)
    blue = rgb_region[:, :, 2].astype(np.float32)
    maximum_channel = np.maximum(np.maximum(red, green), blue)
    minimum_channel = np.minimum(np.minimum(red, green), blue)
    with np.errstate(divide="ignore", invalid="ignore"):
        saturation = np.where(
            maximum_channel > 0,
            (maximum_channel - minimum_channel) / maximum_channel,
            0.0,
        )
    value = maximum_channel / 255.0

    color_mask = (saturation >= 0.12) & (value >= 0.18)
    mask = alpha_mask & color_mask

    if not np.any(mask):
        return None

    # Les 15 % les plus saturés isolent bien la bordure du fond blanc.
    selected_saturation = saturation[mask].ravel()
    selected_rgb = rgb_region[mask].reshape(-1, 3)
    selected_count = max(20, int(0.15 * selected_saturation.size))
    if selected_count >= selected_saturation.size:
        most_saturated_rgb = selected_rgb
    else:
        selected_indices = np.argpartition(selected_saturation, -selected_count)[
            -selected_count:
        ]
        most_saturated_rgb = selected_rgb[selected_indices]

    return _median_rgb(most_saturated_rgb)


def classify_border_color(rgb: Optional[Tuple[int, int, int]]) -> ColorName:
    if rgb is None:
        return "unknown"
    hue, saturation, value = _rgb_to_hsv_deg(rgb)
    name = _classify_hsv(hue, saturation, value, BORDER_CANDIDATES)
    if name != "unknown":
        return name
    # Ces deux règles récupèrent les bordures peu saturées mais visuellement nettes.
    red, green, blue = rgb
    if green >= 95 and green >= 1.18 * max(red, blue):
        return "green"
    # Un violet contient beaucoup de rouge et de bleu, mais peu de vert.
    if min(red, blue) >= 95 and min(red, blue) >= 1.15 * green:
        return "purple"
    return "unknown"


def sample_timer_color(card_img: Image.Image) -> Optional[Tuple[int, int, int]]:
    """Échantillonne la couleur autour du centre du minuteur.

    Les coordonnées sont définies sur l'image de référence, avec une origine
    en bas à gauche, puis adaptées proportionnellement à la taille réelle.
    Les pixels transparents sont ignorés.
    """
    if card_img.mode not in ("RGB", "RGBA"):
        image = card_img.convert("RGBA")
    else:
        image = card_img

    pixels = np.asarray(image, dtype=np.uint8)
    height, width = pixels.shape[:2]

    # Les coordonnées du gabarit sont adaptées aux dimensions de la carte rendue.
    timer_x = int(round((TIMER_X / TIMER_REFERENCE_WIDTH) * width))
    timer_y_from_bottom = int(round((TIMER_Y / TIMER_REFERENCE_HEIGHT) * height))
    timer_y = height - 1 - timer_y_from_bottom  # PIL utilise l'origine en haut.

    x0 = max(0, timer_x - TIMER_SAMPLE_RADIUS)
    x1 = min(width, timer_x + TIMER_SAMPLE_RADIUS + 1)
    y0 = max(0, timer_y - TIMER_SAMPLE_RADIUS)
    y1 = min(height, timer_y + TIMER_SAMPLE_RADIUS + 1)

    region = pixels[y0:y1, x0:x1, :]
    if image.mode == "RGBA":
        alpha = region[:, :, 3]
        mask = alpha >= 200
        rgb = region[:, :, :3][mask]
    else:
        rgb = region.reshape(-1, 3)

    return _median_rgb(rgb.reshape(-1, 3)) if rgb.size else None


def classify_timer_color(rgb: Optional[Tuple[int, int, int]]) -> ColorName:
    if rgb is None:
        return "unknown"
    hue, saturation, value = _rgb_to_hsv_deg(rgb)
    # Une couleur terne ou sombre ne permet pas d'identifier le minuteur proprement.
    if saturation < 0.15 or value < 0.18:
        return "unknown"
    # Ces plages correspondent aux couleurs de minuteur présentes dans les PDF.
    if 75.0 <= hue <= 160.0:
        return "green"
    if 45.0 <= hue < 75.0:
        return "yellow"
    if 25.0 <= hue < 45.0:
        return "orange"
    if hue < 25.0 or hue >= 340.0:
        return "red"
    return _classify_hsv(hue, saturation, value, TIMER_CANDIDATES)


CHAPTER_RE = re.compile(
    r"(?:^|[^a-z0-9])(?:chap(?:ter)?|chapitre|ch)\s*[-_]*\s*(\d+)",
    re.IGNORECASE,
)


def _extract_chapter_number(filename: str) -> Optional[int]:
    stem = os.path.splitext(os.path.basename(filename))[0]
    match = CHAPTER_RE.search(stem)
    return int(match.group(1)) if match else None


def ask_user_to_choose_profile() -> str:
    """Demande le profil de rendu avant la sélection du chapitre."""
    profile_names = list(PROFILES)
    print("\nProfils de traitement :")
    for index, profile_name in enumerate(profile_names, 1):
        print(f"  [{index}] {PROFILES[profile_name].label}")

    while True:
        choice = input(
            "\nChoisissez un profil ([1] par défaut, 'q' pour quitter) : "
        ).strip() or "1"
        if choice.lower() == "q":
            fail("Annulé par l'utilisateur.", code=0)
        if choice.isdigit() and 1 <= int(choice) <= len(profile_names):
            profile_name = profile_names[int(choice) - 1]
            print(f"Profil sélectionné : {PROFILES[profile_name].label}")
            return profile_name
        print(f"Veuillez entrer un nombre entre 1 et {len(profile_names)}.")


def ask_user_to_choose_pdf(search_dir: str) -> List[str]:
    try:
        entries = os.listdir(search_dir)
    except Exception as error:
        fail(f"Impossible de lister le répertoire '{search_dir}' : {error}")

    pdfs = sorted(
        (name for name in entries if name.lower().endswith(".pdf")),
        key=str.lower,
    )
    if not pdfs:
        fail(f"Aucun fichier .pdf trouvé dans : {os.path.abspath(search_dir)}")

    chapter_map: Dict[int, str] = {}
    for name in pdfs:
        chapter = _extract_chapter_number(name)
        if chapter is None:
            continue
        if chapter in chapter_map:
            fail(
                f"Plusieurs PDF correspondent au chapitre {chapter} : "
                f"{chapter_map[chapter]} et {name}."
            )
        chapter_map[chapter] = name

    print("\nPDFs disponibles :")
    print("  [0] Tous les PDFs")
    for chapter, name in sorted(chapter_map.items()):
        print(f"  [{chapter}] {name}")

    while True:
        choice = input(
            "\nEntrez le numéro du chapitre ([0] pour tous, 'q' pour quitter) : "
        ).strip()
        if choice.lower() == "q":
            fail("Annulé par l'utilisateur.", code=0)
        if choice.isdigit():
            chapter_number = int(choice)
            if chapter_number == 0:
                print("Sélection : tous les PDFs.")
                return [
                    os.path.abspath(os.path.join(search_dir, name))
                    for name in pdfs
                ]
            if chapter_number in chapter_map:
                selected = chapter_map[chapter_number]
                input_path = os.path.abspath(os.path.join(search_dir, selected))
                print(f"Sélectionné : {selected}")
                return [input_path]
        print("Veuillez entrer un chapitre existant ou 0.")


def process_pdf(input_path: str, profile: ProcessingProfile) -> None:
    base_name = os.path.splitext(os.path.basename(input_path))[0]
    output_directory = os.path.join(os.path.dirname(input_path), base_name)
    if os.path.exists(output_directory) and not os.path.isdir(output_directory):
        fail(f"Le chemin de sortie existe et n'est pas un dossier : {output_directory}")
    os.makedirs(output_directory, exist_ok=True)

    try:
        document = pymupdf.open(input_path)
    except Exception as error:
        fail(f"Impossible d'ouvrir le PDF : {error}")
    if document.page_count == 0:
        fail("Le PDF est vide.")

    print(f"\n=== Traitement de : {input_path} ===")
    print(f"Dossier de sortie : {output_directory}")
    print(f"Pages : {document.page_count} | DPI : {profile.dpi}")
    compression = "lossless" if profile.lossless else f"quality={profile.webp_quality}"
    print(f"Format : WebP transparent | compression : {compression}")

    cards_by_border = {
        "green": [],
        "orange": [],
        "red": [],
        "purple": [],
        "unknown": [],
    }
    cards_by_timer = {
        "green": [],
        "yellow": [],
        "orange": [],
        "red": [],
        "none": [],
        "unknown": [],
    }
    per_card: Dict[str, Dict[str, Any]] = {}

    card_index = 1
    extension = "webp"
    front_sizes: set[Tuple[int, int]] = set()
    back_sizes: set[Tuple[int, int]] = set()

    save_options = {
        "format": "WEBP",
        "method": profile.webp_method,
        # 90 conserve ici les mêmes valeurs d'alpha que 100, avec un encodage
        # beaucoup plus rapide dès que les coins sont semi-transparents.
        "alpha_quality": profile.alpha_quality,
    }
    if profile.lossless:
        save_options["lossless"] = True
    else:
        save_options["quality"] = profile.webp_quality

    for page_index in range(document.page_count):
        page = document.load_page(page_index)
        print(f"Traitement de la page {page_index + 1}/{document.page_count}...")

        rendered_page = render_page_to_image(page, dpi=profile.dpi)
        cropped_page = crop_to_one_px_margin(rendered_page)
        left_half, right_half = split_halves(cropped_page)

        front_rows = split_rows(left_half)
        back_rows = split_rows(right_half)

        for row_index in range(4):
            front_image = trim_white_edges_midlines(front_rows[row_index])
            back_image = trim_white_edges_midlines(back_rows[row_index])

            front_image = make_external_white_transparent(front_image)
            back_image = make_external_white_transparent(back_image)

            border_rgb = sample_border_color(front_image)
            border_color = classify_border_color(border_rgb)

            if border_color == "purple":
                timer_color: ColorName = "none"
            else:
                timer_rgb = sample_timer_color(front_image)
                timer_color = classify_timer_color(timer_rgb)

            front_path = os.path.join(
                output_directory, f"front{card_index}.{extension}"
            )
            back_path = os.path.join(output_directory, f"back{card_index}.{extension}")
            front_image.save(front_path, **save_options)
            back_image.save(back_path, **save_options)

            print(
                f"  Carte {card_index} enregistrée | bordure={border_color} | timer={timer_color}"
            )

            cards_by_border[border_color].append(card_index)
            cards_by_timer[timer_color].append(card_index)
            front_sizes.add(front_image.size)
            back_sizes.add(back_image.size)

            per_card[str(card_index)] = {
                "border": border_color,
                "timer": timer_color,
                "front": {"width": front_image.width, "height": front_image.height},
                "back": {"width": back_image.width, "height": back_image.height},
            }

            card_index += 1

    total_cards = card_index - 1
    manifest: Dict[str, Any] = {
        "chapter": base_name,
        "asset_version": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "image_format": extension,
        "total_cards": total_cards,
        "cards_by_border": {k: sorted(v) for k, v in cards_by_border.items() if v},
        "cards_by_timer": {k: sorted(v) for k, v in cards_by_timer.items() if v},
        "per_card": per_card,
    }
    if len(front_sizes) == 1:
        front_width, front_height = front_sizes.pop()
        manifest["card_dimensions"] = {
            "front": {"width": front_width, "height": front_height}
        }
    if len(back_sizes) == 1:
        back_width, back_height = back_sizes.pop()
        manifest.setdefault("card_dimensions", {})
        manifest["card_dimensions"]["back"] = {
            "width": back_width,
            "height": back_height,
        }
    manifest_path = os.path.join(output_directory, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as manifest_file:
        json.dump(manifest, manifest_file, ensure_ascii=False, indent=2)

    print(
        f"\nTerminé : {total_cards} cartes dans {output_directory}."
        f"\nManifest : {manifest_path}\n"
    )
    document.close()


def main():
    parser = argparse.ArgumentParser(
        description="Découpe un PDF de flashcards en WebP transparents et crée le manifest.json."
    )
    # Le dossier voisin « flashcards » évite de demander un chemin à chaque lancement.
    default_search = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "flashcards"
    )
    parser.add_argument(
        "--search-dir",
        default=default_search,
        help="Répertoire où chercher les PDFs (défaut: dossier 'flashcards' à côté du script).",
    )
    parser.add_argument(
        "--pdf",
        default=None,
        help="Nom ou chemin d'un PDF à traiter directement (sans sélection interactive).",
    )
    parser.add_argument(
        "--profile",
        choices=PROFILES,
        default=None,
        help=(
            "Profil de sortie : web (recommandé), lossless (archive) ou fast "
            "(aperçu). Sans cette option, le profil est demandé avant le chapitre."
        ),
    )
    args = parser.parse_args()

    # Avec --pdf, le mode reste automatisable : Web s'applique si le profil est omis.
    profile_name = args.profile or (
        "web" if args.pdf else ask_user_to_choose_profile()
    )
    profile = PROFILES[profile_name]

    if args.pdf:
        selected = args.pdf
        candidate = (
            selected
            if os.path.isabs(selected)
            else os.path.join(args.search_dir, selected)
        )
        candidate = os.path.abspath(candidate)
        if not candidate.lower().endswith(".pdf"):
            fail(f"L'argument --pdf doit pointer vers un fichier .pdf : {args.pdf}")
        if not os.path.isfile(candidate):
            fail(f"PDF introuvable : {candidate}")
        selected_paths = [candidate]
    else:
        selected_paths = ask_user_to_choose_pdf(args.search_dir)

    if len(selected_paths) > 1:
        for batch_index, input_path in enumerate(selected_paths, start=1):
            print(f"\n--- Lot {batch_index}/{len(selected_paths)} ---")
            process_pdf(input_path, profile)
    else:
        process_pdf(selected_paths[0], profile)


if __name__ == "__main__":
    main()
