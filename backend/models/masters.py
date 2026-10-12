"""Static masters for the commission grid: Indian insurers, vehicle makes by product type, RTO codes by state.

RTO codes follow the VAHAN state-code + 2-digit office pattern (e.g. TN10). Counts are the highest
office number in use per state — unused numbers in between are harmless in a picker.
"""

from pydantic import BaseModel

from models.policy import AGE_BANDS

# (display name, lowercase keywords used to match the insurer name OCR reads from the policy)
INSURERS: list[tuple[str, list[str]]] = [
    ("ICICI Lombard", ["icici"]), ("HDFC ERGO", ["hdfc"]), ("Bajaj Allianz / Bajaj General", ["bajaj"]),
    ("TATA AIG", ["tata aig"]), ("New India Assurance", ["new india"]), ("United India Insurance", ["united india"]),
    ("National Insurance", ["national insurance"]), ("The Oriental Insurance", ["oriental"]), ("Reliance General", ["reliance"]), ("IndusInd General", ["indusind"]),
    ("SBI General", ["sbi general", "sbi gen"]), ("IFFCO Tokio", ["iffco"]), ("Cholamandalam MS", ["chola"]),
    ("Royal Sundaram", ["royal sundaram", "sundaram"]), ("Generali Central / Future Generali", ["generali"]),
    ("Universal Sompo", ["universal sompo", "sompo"]), ("Shriram General", ["shriram"]), ("Liberty General", ["liberty"]),
    ("Magma General / HDI", ["magma"]), ("Zurich Kotak General", ["kotak", "zurich"]), ("Go Digit", ["digit"]),
    ("Acko", ["acko"]), ("Navi General", ["navi"]), ("Zuno General / Edelweiss", ["zuno", "edelweiss"]),
    ("Raheja QBE", ["raheja", "qbe"]), ("Kshema General", ["kshema"]), ("Agriculture Insurance Co.", ["agriculture insurance"]),
    ("ECGC", ["ecgc"]), ("Star Health", ["star health"]), ("Niva Bupa", ["niva", "bupa"]), ("Care Health", ["care health", "religare"]),
    ("Aditya Birla Health", ["aditya birla"]), ("ManipalCigna", ["manipal", "cigna"]), ("Galaxy Health", ["galaxy"]),
    ("Narayana Health", ["narayana"]),
]
INSURER_KEYWORDS = {name: kws for name, kws in INSURERS}

# product type → common product codes (PRODUCT_CATEGORIES in models/policy.py)
PRODUCT_TYPES: dict[str, list[str]] = {
    "Private Car": ["Private Car Package", "Private Car SAOD", "Private Car SATP", "Private Car 1+3 (Bundle)", "Private Car 3+3 (Long Term)"],
    "Two Wheeler": ["Two Wheeler Package", "Two Wheeler SAOD", "Two Wheeler SATP", "Two Wheeler 1+5 (Bundle)"],
    "PCV": ["PCV - 3W Auto", "PCV - Taxi", "PCV - Maxi Cab", "PCV - Bus", "PCV - School Bus", "PCV - Staff Bus", "PCV - Others"],
    "GCV": ["GCV", "GCV - 3W Goods Carrying"],
    "Misc D": ["Misc D - Tractor", "Misc D - Others"],
    "Health": ["Health"],
    "Others": ["Others"],
}

MAKES: dict[str, list[str]] = {
    "Private Car": [
        "Maruti Suzuki", "Hyundai", "Tata Motors", "Mahindra", "Kia", "Toyota", "Honda", "Renault", "Nissan", "Volkswagen", "Skoda",
        "MG", "Ford", "Jeep", "Citroen", "BYD", "Mercedes-Benz", "BMW", "Audi", "Volvo", "Jaguar", "Land Rover", "Lexus", "Mini",
        "Porsche", "Fiat", "Chevrolet", "Datsun", "Isuzu", "Force Motors", "VinFast",
    ],
    "Two Wheeler": [
        "Hero MotoCorp", "Honda", "TVS", "Bajaj", "Royal Enfield", "Yamaha", "Suzuki", "KTM", "Ather", "Ola Electric", "Jawa", "Yezdi",
        "Harley-Davidson", "Kawasaki", "Triumph", "BMW Motorrad", "Benelli", "Piaggio", "Vespa", "Revolt", "Okinawa", "Ampere",
        "Hero Electric", "Simple Energy", "Ultraviolette", "Bajaj Chetak", "River", "Kinetic Green",
    ],
    "PCV": [
        "Tata Motors", "Ashok Leyland", "Eicher", "Force Motors", "BharatBenz", "Volvo", "Mahindra", "SML Isuzu", "Maruti Suzuki", "Toyota",
        "Hyundai", "Bajaj", "Piaggio", "TVS", "Atul", "Olectra", "PMI Electro", "JBM", "Switch Mobility", "Kia", "Honda", "Renault",
    ],
    "GCV": [
        "Tata Motors", "Ashok Leyland", "Mahindra", "Eicher", "BharatBenz", "Volvo", "Scania", "MAN", "Force Motors", "SML Isuzu", "Isuzu",
        "Piaggio", "Bajaj", "Atul", "Maruti Suzuki", "Kinetic", "Euler", "Altigreen", "Omega Seiki", "AMW", "Montra", "Switch Mobility",
    ],
    "Misc D": [
        "Mahindra", "Sonalika", "Swaraj", "John Deere", "Massey Ferguson / TAFE", "Escorts Kubota", "New Holland", "Eicher Tractors",
        "JCB", "Tata Hitachi", "ACE", "L&T", "CAT", "Kubota", "Preet", "Indo Farm",
    ],
}

# VAHAN state codes → (state / UT name, highest RTO office number)
RTO_STATES: list[tuple[str, str, int]] = [
    ("AN", "Andaman & Nicobar", 2), ("AP", "Andhra Pradesh", 40), ("AR", "Arunachal Pradesh", 22), ("AS", "Assam", 34),
    ("BR", "Bihar", 57), ("CG", "Chhattisgarh", 30), ("CH", "Chandigarh", 4), ("DD", "Dadra & Nagar Haveli and Daman & Diu", 3),
    ("DL", "Delhi", 18), ("GA", "Goa", 12), ("GJ", "Gujarat", 39), ("HR", "Haryana", 99), ("HP", "Himachal Pradesh", 99),
    ("JH", "Jharkhand", 24), ("JK", "Jammu & Kashmir", 22), ("KA", "Karnataka", 71), ("KL", "Kerala", 86), ("LA", "Ladakh", 2),
    ("LD", "Lakshadweep", 9), ("MH", "Maharashtra", 51), ("ML", "Meghalaya", 10), ("MN", "Manipur", 7), ("MP", "Madhya Pradesh", 71),
    ("MZ", "Mizoram", 9), ("NL", "Nagaland", 10), ("OD", "Odisha", 35), ("PB", "Punjab", 99), ("PY", "Puducherry", 5),
    ("RJ", "Rajasthan", 58), ("SK", "Sikkim", 6), ("TN", "Tamil Nadu", 99), ("TR", "Tripura", 8), ("TS", "Telangana", 38),
    ("UK", "Uttarakhand", 20), ("UP", "Uttar Pradesh", 96), ("WB", "West Bengal", 98),
]


FUEL_TYPES = ["Petrol", "Diesel", "CNG", "LPG", "Electric", "Hybrid"]
NON_DIESEL = "Other than Diesel"  # commercial vehicles (e.g. PCV 3W auto) are graded Diesel vs the rest
CNG_LPG = "CNG/LPG"  # matches a policy fuel of CNG or LPG
CV_FUEL_TYPES = ["Diesel", NON_DIESEL, CNG_LPG, "Electric"]
TW_FUEL_TYPES = ["Petrol", "Electric"]
FUEL_BY_TYPE: dict[str, list[str]] = {"Private Car": FUEL_TYPES, "Two Wheeler": TW_FUEL_TYPES, "PCV": CV_FUEL_TYPES, "GCV": CV_FUEL_TYPES}

_CHENNAI = [f"TN{n:02d}" for n in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 22, 85)]
_COIMBATORE = ["TN37", "TN38", "TN66", "TN99"]
# quick-pick RTO zones — stored on the rule as plain RTO codes
RTO_ZONES: list[tuple[str, list[str]]] = [
    ("Chennai RTOs", _CHENNAI),
    ("Coimbatore RTOs", _COIMBATORE),
    ("ROTN (Rest of Tamil Nadu)", [f"TN{n:02d}" for n in range(1, 100) if f"TN{n:02d}" not in _CHENNAI + _COIMBATORE]),
]


class RtoZone(BaseModel):
    name: str
    rtos: list[str]


class RtoState(BaseModel):
    code: str
    name: str
    rtos: list[str]


class CommissionMasters(BaseModel):
    insurers: list[str]
    product_types: dict[str, list[str]]
    makes: dict[str, list[str]]
    rto_states: list[RtoState]
    age_bands: list[str]
    fuel_types: list[str]
    cv_fuel_types: list[str]
    rto_zones: list[RtoZone]
    fuel_by_type: dict[str, list[str]]
    business_types: list[str] = ["New", "Renewal", "Rollover", "Used"]
    models: dict[str, list[str]] = {}  # make → models added by admin


def masters() -> CommissionMasters:
    return CommissionMasters(
        insurers=[n for n, _ in INSURERS],
        product_types=PRODUCT_TYPES,
        makes=MAKES,
        age_bands=AGE_BANDS,
        fuel_types=FUEL_TYPES,
        cv_fuel_types=CV_FUEL_TYPES,
        fuel_by_type=FUEL_BY_TYPE,
        rto_zones=[RtoZone(name=n, rtos=c) for n, c in RTO_ZONES],
        rto_states=[RtoState(code=c, name=n, rtos=[f"{c}{i:02d}" for i in range(1, mx + 1)]) for c, n, mx in RTO_STATES],
    )
