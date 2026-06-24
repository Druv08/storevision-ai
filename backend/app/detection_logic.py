from datetime import datetime, date
from app.shelf import shelf_layout


def generate_alerts(detected_data):
    alerts = []

    for slot, expected in shelf_layout.items():
        detected = detected_data.get(slot)

        if detected is None:
            alerts.append({
                "type": "missing_item",
                "severity": "high",
                "slot": slot,
                "expected": expected,
                "detected": None,
                "message": f"{expected} is missing from slot {slot}"
            })

        elif detected != expected:
            alerts.append({
                "type": "wrong_placement",
                "severity": "medium",
                "slot": slot,
                "expected": expected,
                "detected": detected,
                "message": f"{detected} is in wrong slot {slot}, expected {expected}"
            })

    return alerts


def check_expiry(products):
    alerts = []
    today = date.today()

    for p in products:
        try:
            expiry = datetime.strptime(p["expiry_date"], "%Y-%m-%d").date()
        except Exception:
            continue

        days_left = (expiry - today).days

        if days_left < 0:
            alerts.append({
                "type": "expired_product",
                "severity": "critical",
                "slot": p["slot"],
                "product": p["name"],
                "message": f"{p['name']} is EXPIRED"
            })

        elif days_left <= 7:
            alerts.append({
                "type": "near_expiry",
                "severity": "low",
                "slot": p["slot"],
                "product": p["name"],
                "message": f"{p['name']} expires in {days_left} days"
            })

    return alerts


def check_old_stock(products):
    alerts = []
    today = date.today()

    for p in products:
        entry_str = p.get("stock_entry_date")
        if not entry_str:
            continue

        entry = datetime.strptime(entry_str, "%Y-%m-%d").date()
        days = (today - entry).days

        if days > 10:  # demo-friendly threshold
            alerts.append({
                "type": "old_stock",
                "severity": "low",
                "slot": p["slot"],
                "product": p["name"],
                "message": f"{p['name']} has been on shelf for {days} days"
            })

    return alerts


def generate_all_alerts(detected_data, products):
    return (
        generate_alerts(detected_data)
        + check_expiry(products)
        + check_old_stock(products)
    )