"""Formula-injection guard for spreadsheet exports: text from policies / users must never run as a formula."""
DANGEROUS = ("=", "+", "-", "@", "\t", "\r")


def safe_text(v):
    """CSV value: text starting with a formula character is prefixed with ' (numbers are left alone)."""
    if isinstance(v, str) and v.startswith(DANGEROUS):
        try:
            float(v)
            return v  # plain negative / signed number
        except ValueError:
            return "'" + v
    return v


def neutralise_formulas(wb) -> None:
    """openpyxl stores any string starting with '=' as a formula — exports write no formulas, so store them as text."""
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.data_type == "f" and isinstance(c.value, str):
                    c.value = "'" + c.value
                    c.data_type = "s"
