from rich.console import Console

console = Console()

CORRELATION_COLORS = {
    'strong_positive': '#4575b4',
    'moderate_positive': '#74add1',
    'weak': '#e0f3f8',
    'moderate_negative': '#fdae61',
    'strong_negative': '#d73027',
}

HEATMAP_PALETTE = [
    '#d73027', '#f46d43', '#fdae61', '#fee090',
    '#e0f3f8', '#abd9e9', '#74add1', '#4575b4',
]

NETWORK_COLORS = {
    'positive': '#91cc75',
    'negative': '#ee6666',
    'neutral': '#5470c6',
}


def truncate_label(label: str, max_len: int = 12) -> str:
    return label[:max_len]


def get_rich_color(value: float) -> str:
    if value > 0.5:
        return "green"
    if value < -0.5:
        return "red"
    return "white"


def get_confidence_color(confidence: float) -> str:
    if confidence > 0.7:
        return "green"
    if confidence > 0.5:
        return "yellow"
    return "white"


def get_movement_color(value: float) -> str:
    if value > 0:
        return "green"
    if value < 0:
        return "red"
    return "white"


def get_network_node_color(avg_corr: float) -> str:
    if avg_corr > 0.3:
        return NETWORK_COLORS['positive']
    if avg_corr < -0.3:
        return NETWORK_COLORS['negative']
    return NETWORK_COLORS['neutral']


def get_edge_color(corr_val: float) -> str:
    return NETWORK_COLORS['positive'] if corr_val > 0 else NETWORK_COLORS['negative']
