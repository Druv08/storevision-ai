from app.shelf import shelf_layout

def generate_alerts(detected_data):
    alerts = []

    for slot, expected in shelf_layout.items():
        detected = detected_data.get(slot)

        if detected is None:
            alerts.append({
                "type": "missing_item",
                "slot": slot,
                "expected": expected,
                "detected": None,
                "message": f"{expected} is missing from slot {slot}"
            })

        elif detected != expected:
            alerts.append({
                "type": "wrong_placement",
                "slot": slot,
                "expected": expected,
                "detected": detected,
                "message": f"{detected} is in wrong slot {slot}, expected {expected}"
            })

    return alerts