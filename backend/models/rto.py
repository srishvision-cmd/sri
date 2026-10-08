"""Tamil Nadu RTO office name → code, for policies where OCR read the registering authority name (e.g. new vehicles)."""
import re
from typing import Optional

TN_RTO = {
    "chennai central": "TN01", "ayanavaram": "TN01", "anna nagar": "TN02", "tondiarpet": "TN03", "basin bridge": "TN04", "kolathur": "TN05",
    "mandaveli": "TN06", "thiruvanmiyur": "TN07", "k k nagar": "TN09", "kk nagar": "TN09", "valasaravakkam": "TN10", "tambaram": "TN11",
    "poonamallee": "TN12", "ambattur": "TN13", "sholinganallur": "TN14", "ulundurpet": "TN15", "tindivanam": "TN16", "redhills": "TN18",
    "red hills": "TN18", "chengalpattu": "TN19", "chengalpet": "TN19", "tiruvallur": "TN20", "thiruvallur": "TN20", "kancheepuram": "TN21",
    "kanchipuram": "TN21", "meenambakkam": "TN22", "vellore": "TN23", "krishnagiri": "TN24", "tiruvannamalai": "TN25", "thiruvannamalai": "TN25",
    "namakkal": "TN28", "dharmapuri": "TN29", "salem west": "TN30", "cuddalore": "TN31", "villupuram": "TN32", "viluppuram": "TN32",
    "erode east": "TN33", "erode": "TN33", "tiruchengode": "TN34", "gobichettipalayam": "TN36", "gobi": "TN36", "coimbatore south": "TN37",
    "coimbatore north": "TN38", "tiruppur north": "TN39", "tirupur north": "TN39", "tiruppur": "TN39", "tirupur": "TN39", "mettupalayam": "TN40",
    "pollachi": "TN41", "tiruppur south": "TN42", "tirupur south": "TN42", "ooty": "TN43", "udhagamandalam": "TN43", "nilgiris": "TN43",
    "trichy west": "TN45", "tiruchirappalli west": "TN45", "trichy": "TN45", "tiruchirappalli": "TN45", "perambalur": "TN46", "karur": "TN47",
    "srirangam": "TN48", "thanjavur": "TN49", "tiruvarur": "TN50", "thiruvarur": "TN50", "nagapattinam": "TN51", "sankagiri": "TN52",
    "salem east": "TN54", "salem": "TN54", "pudukkottai": "TN55", "pudukottai": "TN55", "perundurai": "TN56", "dindigul": "TN57",
    "madurai south": "TN58", "madurai north": "TN59", "madurai": "TN59", "theni": "TN60", "ariyalur": "TN61", "sivaganga": "TN63",
    "sivagangai": "TN63", "madurai central": "TN64", "ramanathapuram": "TN65", "coimbatore central": "TN66", "coimbatore": "TN66",
    "virudhunagar": "TN67", "kumbakonam": "TN68", "thoothukudi": "TN69", "tuticorin": "TN69", "hosur": "TN70", "tirunelveli": "TN72",
    "ranipet": "TN73", "nagercoil": "TN74", "marthandam": "TN75", "tenkasi": "TN76", "attur": "TN77", "dharapuram": "TN78",
    "sankarankovil": "TN79", "sankarankoil": "TN79", "trichy east": "TN81", "tiruchirappalli east": "TN81", "mayiladuthurai": "TN82",
    "vaniyambadi": "TN83", "srivilliputhur": "TN84", "kundrathur": "TN85", "erode west": "TN86", "sriperumbudur": "TN87",
    "namakkal south": "TN88", "salem south": "TN90", "chidambaram": "TN91", "tiruchendur": "TN92", "mettur": "TN93", "palani": "TN94",
    "sivakasi": "TN95", "arani": "TN97", "coimbatore west": "TN99",
}
_KEYS = sorted(TN_RTO, key=len, reverse=True)  # longest first: "coimbatore south" before "coimbatore"
CODE = re.compile(r"^([A-Z]{2})[\s-]?(\d{1,2})$")


def rto_code(value) -> Optional[str]:
    """'TN 75' / 'tn-75' → 'TN75'; 'MARTHANDAM' / 'RTO Marthandam' → 'TN75'; unknown → None."""
    s = str(value or "").strip()
    if not s:
        return None
    m = CODE.match(s.upper())
    if m:
        return f"{m.group(1)}{int(m.group(2)):02d}"
    t = " " + re.sub(r"[^a-z]+", " ", s.lower()).strip() + " "
    return next((TN_RTO[k] for k in _KEYS if f" {k} " in t), None)
