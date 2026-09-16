"""Sample dataset for testing/demoing the scheduler. Replace with real
refinery/depot feeds when integrating."""

from datetime import datetime, timedelta
from scheduler import Batch, Truck, Order

BASE = datetime(2026, 9, 15, 6, 0)  # 06:00 start of shift


def fresh_dataset():
    """Returns (batches, trucks, orders) -- fresh objects each call so tests don't share mutable state."""
    batches = [
        Batch("B-001", "diesel", 40000, BASE, "Refinery-Gantry-1"),
        Batch("B-002", "petrol", 30000, BASE + timedelta(minutes=30), "Refinery-Gantry-2"),
        Batch("B-003", "diesel", 25000, BASE + timedelta(hours=2), "Refinery-Gantry-1"),
    ]

    trucks = [
        Truck("T-01", 15000, "Depot-Yard", BASE, BASE + timedelta(hours=10)),
        Truck("T-02", 20000, "Depot-Yard", BASE, BASE + timedelta(hours=10)),
        Truck("T-03", 15000, "Depot-Yard", BASE + timedelta(hours=1), BASE + timedelta(hours=9)),
        Truck("T-04", 25000, "Depot-Yard", BASE, BASE + timedelta(hours=10)),
    ]

    orders = [
        Order("O-101", "Nakuru Fuels Ltd", "Nakuru", 12000,
              BASE + timedelta(hours=2), BASE + timedelta(hours=5), product_type="diesel"),
        Order("O-102", "Eldoret Energy", "Eldoret", 18000,
              BASE + timedelta(hours=2), BASE + timedelta(hours=6), product_type="petrol"),
        Order("O-103", "Nyeri Petro", "Nyeri", 9000,
              BASE + timedelta(hours=1), BASE + timedelta(hours=4), product_type="diesel"),
        Order("O-104", "Meru Fuels", "Meru", 14000,
              BASE + timedelta(hours=3), BASE + timedelta(hours=7), product_type="diesel"),
        Order("O-105", "Kisumu Oil Co", "Kisumu", 20000,
              BASE + timedelta(hours=1, minutes=30), BASE + timedelta(hours=5), product_type="petrol"),
    ]

    return batches, trucks, orders
