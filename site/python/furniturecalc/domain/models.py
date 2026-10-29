"""Не зависящие от интерфейса модели мебельного расчёта."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal


ZERO = Decimal("0")
SQUARE_MILLIMETERS_IN_SQUARE_METER = Decimal("1000000")
MILLIMETERS_IN_METER = Decimal("1000")


def _require_name(value: str, field_name: str) -> None:
    if not value.strip():
        raise ValueError(f"{field_name} не может быть пустым")


def _require_positive(value: Decimal | int, field_name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (Decimal, int)):
        raise TypeError(f"{field_name} должно быть целым числом или Decimal")
    if value <= 0:
        raise ValueError(f"{field_name} должно быть больше нуля")


def _require_money(value: Decimal, field_name: str) -> None:
    if not isinstance(value, Decimal):
        raise TypeError(f"{field_name} должно быть Decimal")
    if value < ZERO:
        raise ValueError(f"{field_name} не может быть отрицательным")


@dataclass(frozen=True)
class Material:
    """Листовой материал; размеры указаны в мм, цена — в рублях за лист."""

    name: str
    thickness_mm: Decimal | int
    sheet_length_mm: Decimal | int
    sheet_width_mm: Decimal | int
    sheet_price_rub: Decimal

    def __post_init__(self) -> None:
        _require_name(self.name, "Название материала")
        _require_positive(self.thickness_mm, "Толщина листа")
        _require_positive(self.sheet_length_mm, "Длина листа")
        _require_positive(self.sheet_width_mm, "Ширина листа")
        _require_money(self.sheet_price_rub, "Цена листа")

    @property
    def sheet_area_square_meters(self) -> Decimal:
        return (
            Decimal(self.sheet_length_mm) * Decimal(self.sheet_width_mm)
            / SQUARE_MILLIMETERS_IN_SQUARE_METER
        )

    @property
    def preliminary_price_per_square_meter_rub(self) -> Decimal:
        return self.sheet_price_rub / self.sheet_area_square_meters


@dataclass(frozen=True)
class Part:
    """Прямоугольная мебельная деталь с размерами в мм."""

    name: str
    material: Material
    length_mm: Decimal | int
    width_mm: Decimal | int
    quantity: int = 1

    def __post_init__(self) -> None:
        _require_name(self.name, "Название детали")
        _require_positive(self.length_mm, "Длина детали")
        _require_positive(self.width_mm, "Ширина детали")
        if isinstance(self.quantity, bool) or not isinstance(self.quantity, int):
            raise TypeError("Количество деталей должно быть целым числом")
        if self.quantity <= 0:
            raise ValueError("Количество деталей должно быть больше нуля")

    @property
    def area_square_meters(self) -> Decimal:
        """Суммарная площадь всех экземпляров этой детали."""
        return (
            Decimal(self.length_mm)
            * Decimal(self.width_mm)
            * Decimal(self.quantity)
            / SQUARE_MILLIMETERS_IN_SQUARE_METER
        )


@dataclass(frozen=True)
class EdgeBand:
    """Тип кромки с ценой в рублях за погонный метр."""

    name: str
    price_per_meter_rub: Decimal

    def __post_init__(self) -> None:
        _require_name(self.name, "Название кромки")
        _require_money(self.price_per_meter_rub, "Цена кромки")


@dataclass(frozen=True)
class EdgeBandUsage:
    edge_band: EdgeBand
    length_mm: Decimal | int

    def __post_init__(self) -> None:
        _require_positive(self.length_mm, "Длина кромления")

    @property
    def length_meters(self) -> Decimal:
        return Decimal(self.length_mm) / MILLIMETERS_IN_METER


@dataclass(frozen=True)
class HardwareItem:
    """Позиция фурнитуры с ценой в рублях за штуку."""

    name: str
    unit_price_rub: Decimal

    def __post_init__(self) -> None:
        _require_name(self.name, "Название фурнитуры")
        _require_money(self.unit_price_rub, "Цена фурнитуры")


@dataclass(frozen=True)
class HardwareUsage:
    item: HardwareItem
    quantity: int

    def __post_init__(self) -> None:
        if isinstance(self.quantity, bool) or not isinstance(self.quantity, int):
            raise TypeError("Количество фурнитуры должно быть целым числом")
        if self.quantity <= 0:
            raise ValueError("Количество фурнитуры должно быть больше нуля")


@dataclass(frozen=True)
class MaterialCostLine:
    material: Material
    part_count: int
    parts_area_square_meters: Decimal
    preliminary_price_per_square_meter_rub: Decimal
    preliminary_cost_rub: Decimal


@dataclass(frozen=True)
class EdgeCostLine:
    edge_band: EdgeBand
    length_meters: Decimal
    cost_rub: Decimal


@dataclass(frozen=True)
class HardwareCostLine:
    item: HardwareItem
    quantity: int
    cost_rub: Decimal


@dataclass(frozen=True)
class Estimate:
    """Подробный результат предварительного расчёта."""

    material_lines: tuple[MaterialCostLine, ...]
    edge_lines: tuple[EdgeCostLine, ...]
    hardware_lines: tuple[HardwareCostLine, ...]
    total_part_count: int
    total_parts_area_square_meters: Decimal
    materials_cost_rub: Decimal
    edges_cost_rub: Decimal
    hardware_cost_rub: Decimal
    total_cost_rub: Decimal
    material_cost_note: str = (
        "Стоимость листового материала рассчитана предварительно по площади деталей; "
        "это не точный раскрой и не количество листов к закупке."
    )
