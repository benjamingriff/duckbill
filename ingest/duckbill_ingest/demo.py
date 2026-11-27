"""Synthetic raw data shaped like Monzo API responses.

Lets the pipeline and dashboard run end to end without credentials. It writes
two ingest runs: a backfill three days ago (with the newest card payments still
pending) and an incremental sync today in which they have settled, one with a
changed amount. That exercises the "latest version wins" logic in silver.

It also carries the metadata the gold models read: subscription, mandate and
standing order ids, merchant codes, a trip each June, split bills, transfers
to yourself, a custom category, and three pots: a savings pot, one with a goal,
and one since closed, which Monzo still lists with deleted: true.
"""

from __future__ import annotations

import random
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from .client import PAGE_LIMIT
from .raw import RawWriter, iso, new_run_id
from .storage import Store

ACCOUNT_ID = "acc_demo0000000000000001"
USER_ID = "user_demo000000000000001"
POT_ID = "pot_demo0000000000000001"  # Rainy day, a savings pot with no goal
HOLIDAY_POT_ID = "pot_demo0000000000000002"  # with a goal
CLOSED_POT_ID = "pot_demo0000000000000003"  # Concert tickets, emptied and closed long ago
CUSTOM_CATEGORY = "category_0000DemoClimbing"


@dataclass(frozen=True)
class Merchant:
    name: str
    description: str
    category: str
    emoji: str
    low: int  # pence
    high: int
    per_week: float
    online: bool = False
    mcc: str = ""


# mcc is the card merchant code: 5814 fast food (takeaway), 5812 restaurants.
MERCHANTS = [
    Merchant(
        "Pret A Manger", "PRET A MANGER LONDON GBR", "eating_out", "☕", 280, 650, 4.0, mcc="5814"
    ),
    Merchant("Starbucks", "STARBUCKS LONDON GBR", "eating_out", "☕", 310, 560, 1.2, mcc="5814"),
    Merchant("Dishoom", "DISHOOM SHOREDITCH", "eating_out", "🍛", 2400, 5200, 0.25, mcc="5812"),
    Merchant("Deliveroo", "DELIVEROO.CO.UK", "eating_out", "🛵", 1600, 3400, 0.7, True, "5814"),
    Merchant("Tesco", "TESCO STORES 2041", "groceries", "🛒", 900, 6500, 1.6, mcc="5411"),
    Merchant("Sainsbury's", "SAINSBURYS S/MKTS", "groceries", "🛒", 1200, 4800, 0.8, mcc="5411"),
    Merchant(
        "Transport for London", "TFL TRAVEL CHARGE", "transport", "🚇", 280, 890, 4.5, mcc="4111"
    ),
    Merchant("Uber", "UBER *TRIP", "transport", "🚕", 900, 2600, 0.4, True, "4121"),
    Merchant("Amazon", "AMAZON.CO.UK*", "shopping", "📦", 800, 7500, 0.8, True, "5942"),
    Merchant("Uniqlo", "UNIQLO REGENT ST", "shopping", "👕", 1500, 9000, 0.12, mcc="5651"),
    Merchant("Vue Cinemas", "VUE BSL LTD", "entertainment", "🎬", 1100, 2600, 0.2, mcc="7832"),
    Merchant("Boots", "BOOTS 1123", "personal_care", "💊", 350, 2800, 0.4, mcc="5912"),
    Merchant(
        "Climbing Hangar", "THE CLIMBING HANGAR", CUSTOM_CATEGORY, "🧗", 1200, 1600, 0.5, mcc="7997"
    ),
    Merchant("PureGym", "PUREGYM", "personal_care", "🏋️", 2499, 2499, 0.0, mcc="7997"),
    Merchant("Netflix", "NETFLIX.COM", "entertainment", "🍿", 1099, 1099, 0.0, True, "4899"),
    Merchant("Spotify", "SPOTIFY", "entertainment", "🎧", 1199, 1199, 0.0, True, "5815"),
]
SUBSCRIPTIONS = {"PureGym": 3, "Netflix": 12, "Spotify": 20}  # day of month


class _Builder:
    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.rows: list[dict[str, Any]] = []
        self._seq = 0

    def _id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}_demo{self._seq:018d}"

    def card(
        self,
        merchant: Merchant,
        at: datetime,
        amount: int,
        *,
        local: tuple[int, str] | None = None,
        city: tuple[str, str] = ("London", "GBR"),
    ) -> dict[str, Any]:
        tx = self._base(at, -amount, merchant.description, merchant.category, "mastercard")
        if merchant.mcc:
            tx["metadata"]["mcc"] = merchant.mcc
        tx["merchant"] = {
            "id": "merch_demo_" + merchant.name.lower().replace(" ", "_").replace("'", ""),
            "group_id": "grp_demo_" + merchant.name.lower().replace(" ", "_").replace("'", ""),
            "name": merchant.name,
            "emoji": merchant.emoji,
            "category": merchant.category,
            "online": merchant.online,
            "atm": False,
            "logo": "",
            "address": {"city": city[0], "country": city[1], "postcode": ""},
            "metadata": {},
        }
        if local:
            tx["local_amount"], tx["local_currency"] = -local[0], local[1]
        return self._add(tx)

    def transfer(
        self,
        at: datetime,
        amount: int,
        name: str,
        category: str,
        scheme: str,
        include_in_spending: bool,
        metadata: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        tx = self._base(at, amount, name.upper(), category, scheme)
        tx["counterparty"] = {"name": name}
        tx["include_in_spending"] = include_in_spending
        tx["metadata"].update(metadata or {})
        return self._add(tx)

    def pot(self, at: datetime, amount: int, pot_id: str = POT_ID) -> dict[str, Any]:
        tx = self._base(at, amount, pot_id, "savings", "uk_retail_pot")
        tx["metadata"] = {"pot_id": pot_id, "trigger": "user"}
        tx["include_in_spending"] = False
        return self._add(tx)

    def _base(self, at: datetime, amount: int, desc: str, category: str, scheme: str) -> dict:
        settled = at + timedelta(days=1, hours=self.rng.randint(0, 20))
        return {
            "id": self._id("tx"),
            "created": iso(at),
            "updated": iso(settled),
            "settled": iso(settled),
            "description": desc,
            "amount": amount,
            "currency": "GBP",
            "local_amount": amount,
            "local_currency": "GBP",
            "category": category,
            "categories": {category: amount},
            "is_load": False,
            "account_id": ACCOUNT_ID,
            "user_id": USER_ID,
            "merchant": None,
            "counterparty": {},
            "metadata": {},
            "notes": "",
            "scheme": scheme,
            "include_in_spending": True,
            "amount_is_pending": False,
            "dedupe_id": secrets.token_hex(8),
            "originator": False,
            "fees": {},
            "attachments": [],
        }

    def _add(self, tx: dict[str, Any]) -> dict[str, Any]:
        self.rows.append(tx)
        return tx


def _random_time(rng: random.Random, day: datetime) -> datetime:
    return day + timedelta(hours=rng.randint(7, 21), minutes=rng.randint(0, 59))


def generate(now: datetime, months: int = 26, seed: int = 7) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    b = _Builder(rng)
    start = (now - timedelta(days=months * 30.5)).replace(hour=0, minute=0, second=0, microsecond=0)
    by_name = {m.name: m for m in MERCHANTS}

    b.transfer(
        start + timedelta(hours=9),
        150_000,
        "Opening deposit",
        "transfers",
        "payport_faster_payments",
        False,
    )

    day = start
    while day < now:
        # Seasonal and slow drift so the monthly chart has some shape.
        month_factor = 1.0 + 0.18 * (day.month in (11, 12)) + 0.08 * (day.month in (7, 8))
        drift = 1.0 + 0.15 * ((day - start).days / (now - start).days)

        if day.day == 25:
            b.transfer(
                day + timedelta(hours=6),
                340_000 + rng.randint(-2_000, 2_000),
                "ACME Ltd",
                "income",
                "bacs",
                False,
            )
        if day.day == 1:
            b.transfer(
                day + timedelta(hours=8),
                -145_000,
                "Landlord",
                "bills",
                "payport_faster_payments",
                True,
                {"series_id": "series_demo_rent"},  # a standing order
            )
            b.transfer(
                day + timedelta(hours=9),
                -6_800 - 400 * (day.month in (12, 1, 2)),
                "Octopus Energy",
                "bills",
                "bacs",
                True,
                {"bacs_direct_debit_instruction_id": "mandate_demo_octopus"},
            )
        if day.day == 26:
            b.pot(day + timedelta(hours=10), -rng.choice([30_000, 40_000, 50_000]))
        if day.day == 27:
            b.pot(day + timedelta(hours=10), -10_000, HOLIDAY_POT_ID)
        if day.day == 14 and rng.random() < 0.15:
            b.pot(day + timedelta(hours=10), rng.choice([15_000, 25_000]))  # dip into savings
        if day.day == 28 and day.month % 3 == 0:
            # To your own account elsewhere. Monzo counts it as spending; gold must not.
            b.transfer(
                day + timedelta(hours=12),
                -20_000,
                "Demo Saver",
                "transfers",
                "p2p_payment",
                True,
                {"p2p_is_to_self": "true"},
            )
        if day.day == 3 and rng.random() < 0.5:
            # A friend paying you back: income, but not salary.
            b.transfer(
                day + timedelta(hours=19),
                rng.randint(1_500, 4_000),
                "Sam Taylor",
                "general",
                "p2p_payment",
                False,
                {"p2p_is_to_self": "false"},
            )
        for name, dom in SUBSCRIPTIONS.items():
            if day.day == dom:
                m = by_name[name]
                sub = b.card(m, _random_time(rng, day), m.low)
                sub["metadata"]["subscription_id"] = "sub_demo_" + name.lower()

        for m in MERCHANTS:
            if m.per_week == 0:
                continue
            weekday_boost = 1.4 if (m.category == "eating_out" and day.weekday() < 5) else 1.0
            if rng.random() < m.per_week / 7 * month_factor * weekday_boost:
                amount = int(rng.randint(m.low, m.high) * drift)
                tx = b.card(m, _random_time(rng, day), amount)
                if m.name == "Dishoom" and rng.random() < 0.3:
                    tx["metadata"]["bill_splitting_id"] = b._id("split")
                if m.name == "Amazon" and rng.random() < 0.08:
                    refund = b.card(m, _random_time(rng, day + timedelta(days=6)), -amount)
                    refund["description"] = "AMAZON.CO.UK* REFUND"
        if day.month == 6 and day.day == 9:  # empty the holiday pot for the trip
            held = -sum(
                r["amount"] for r in b.rows if r["metadata"].get("pot_id") == HOLIDAY_POT_ID
            )
            if held > 0:
                b.pot(day + timedelta(hours=8), held, HOLIDAY_POT_ID)
        if day.month == 6 and 10 <= day.day <= 16:  # a holiday abroad, which Monzo spots
            paris = ("Paris", "FRA")
            if day.day == 10:
                m = Merchant("Hôtel du Nord", "HOTEL DU NORD PARIS FRA", "holidays", "🏨", 0, 0, 0)
                eur = rng.randint(52_000, 64_000)
                hotel = b.card(
                    m, _random_time(rng, day), int(eur * 0.86), local=(eur, "EUR"), city=paris
                )
                hotel["metadata"]["trip_id"] = f"trip_demo_{day.year}"
            m = Merchant("Café de Flore", "CAFE DE FLORE PARIS FRA", "holidays", "🥐", 900, 4000, 0)
            eur = rng.randint(m.low, m.high)
            cafe = b.card(
                m, _random_time(rng, day), int(eur * 0.86), local=(eur, "EUR"), city=paris
            )
            cafe["metadata"]["trip_id"] = f"trip_demo_{day.year}"
        if rng.random() < 0.01:
            declined = b.card(by_name["Amazon"], _random_time(rng, day), rng.randint(5000, 20000))
            declined["decline_reason"] = "INSUFFICIENT_FUNDS"
            declined["settled"] = ""

        day += timedelta(days=1)

    # After the loop, so the random draws above (and every other row) don't shift.
    # Money set aside and taken back out the same day, then the pot was closed.
    concert = start + timedelta(days=60)
    b.pot(concert + timedelta(hours=9), -8_000, CLOSED_POT_ID)
    b.pot(concert + timedelta(hours=18), 8_000, CLOSED_POT_ID)

    b.rows = [r for r in b.rows if r["created"] <= iso(now)]
    b.rows.sort(key=lambda r: r["created"])
    return b.rows


def _pending_view(tx: dict[str, Any], as_of: datetime) -> dict[str, Any]:
    """How a transaction looked before it settled (card payments only)."""
    if tx["scheme"] != "mastercard" or tx.get("decline_reason"):
        return tx
    if tx["settled"] <= iso(as_of):
        return tx
    pending = dict(tx, settled="", updated=tx["created"], amount_is_pending=True)
    if tx["description"].startswith("TFL"):
        pending["amount"] = pending["local_amount"] = -280  # TfL caps settle later
    return pending


def _write_transactions(writer: RawWriter, rows: list[dict], since: str, at: datetime) -> None:
    window = [r for r in rows if r["created"] > since]
    for i in range(0, max(len(window), 1), PAGE_LIMIT):
        page = window[i : i + PAGE_LIMIT]
        cursor = since if i == 0 else window[i - 1]["id"]
        params = {
            "account_id": ACCOUNT_ID,
            "expand[]": "merchant",
            "limit": str(PAGE_LIMIT),
            "since": cursor,
        }
        writer.write("transactions", params, {"transactions": page}, fetched_at=at)


def _balance(rows: list[dict]) -> int:
    return sum(r["amount"] for r in rows if not r.get("decline_reason"))


def write_demo(store: Store, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(UTC)
    rows = generate(now)
    account = {
        "id": ACCOUNT_ID,
        "description": USER_ID,
        "created": iso(datetime.fromisoformat(rows[0]["created"]) - timedelta(days=1)),
        "closed": False,
        "type": "uk_retail",
        "currency": "GBP",
        "country_code": "GB",
        "owners": [{"user_id": USER_ID, "preferred_name": "Demo"}],
    }

    backfill_at = now - timedelta(days=3)
    for at, since in ((backfill_at, account["created"]), (now, iso(now - timedelta(days=14)))):
        visible = [_pending_view(r, at) for r in rows if r["created"] <= iso(at)]
        with RawWriter(store, new_run_id(at)) as writer:
            writer.write("accounts", {"account_type": "uk_retail"}, {"accounts": [account]}, at)
            _write_transactions(writer, visible, since, at)
            balance = _balance(visible)
            pots_at = {
                pot_id: -sum(r["amount"] for r in visible if r["metadata"].get("pot_id") == pot_id)
                for pot_id in (POT_ID, HOLIDAY_POT_ID)
            }
            writer.write(
                "balance",
                {"account_id": ACCOUNT_ID},
                {
                    "balance": balance,
                    "total_balance": balance + sum(pots_at.values()),
                    "currency": "GBP",
                    "spend_today": 0,
                },
                at,
            )
            writer.write(
                "pots",
                {"current_account_id": ACCOUNT_ID},
                {
                    "pots": [
                        {
                            "id": POT_ID,
                            "name": "Rainy day",
                            "style": "beach_ball",
                            "balance": pots_at[POT_ID],
                            "currency": "GBP",
                            "type": "flexible_savings",  # an Instant Access savings pot
                            "available_for_bills": False,
                            "created": rows[0]["created"],
                            "updated": iso(at),
                            "deleted": False,
                        },
                        {
                            "id": HOLIDAY_POT_ID,
                            "name": "Holiday",
                            "style": "palm_tree",
                            "balance": pots_at[HOLIDAY_POT_ID],
                            "goal_amount": 150_000,
                            "currency": "GBP",
                            "type": "default",
                            "available_for_bills": False,
                            "created": rows[0]["created"],
                            "updated": iso(at),
                            "deleted": False,
                        },
                        {
                            "id": CLOSED_POT_ID,
                            "name": "Concert tickets",
                            "style": "music",
                            "balance": 0,
                            "currency": "GBP",
                            "type": "default",
                            "available_for_bills": False,
                            "created": rows[0]["created"],
                            "updated": rows[0]["created"],
                            "deleted": True,
                        },
                    ]
                },
                at,
            )
    return {"transactions": len(rows)}
