"""Чистые функции расчёта стоимости."""

from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal

from furniturecalc.domain.models import (
    EdgeBand,
    EdgeBandUsage,
    EdgeCostLine,
    Estimate,
    HardwareCostLine,
    HardwareItem,
    HardwareUsage,
    Material,
    MaterialCostLine,
    Part,
)


ZERO = Decimal("0")


def calculate_estimate(
    parts: Iterable[Part],
    edge_usages: Iterable[EdgeBandUsage] = (),
    hardware_usages: Iterable[HardwareUsage] = (),
) -> Estimate:
    """Рассчитать предварительную стоимость материалов, кромки и фурнитуры."""
    part_list = tuple(parts)
    edge_usage_list = tuple(edge_usages)
    hardware_usage_list = tuple(hardware_usages)

    material_totals: dict[Material, tuple[int, Decimal]] = {}
    for part in part_list:
        current_count, current_area = material_totals.get(part.material, (0, ZERO))
        material_totals[part.material] = (
            current_count + part.quantity,
            current_area + part.area_square_meters,
        )

    material_lines = tuple(
        MaterialCostLine(
            material=material,
            part_count=part_count,
            parts_area_square_meters=area,
            preliminary_price_per_square_meter_rub=(
                material.preliminary_price_per_square_meter_rub
            ),
            preliminary_cost_rub=(
                area * material.preliminary_price_per_square_meter_rub
            ),
        )
        for material, (part_count, area) in material_totals.items()
    )

    edge_totals: dict[EdgeBand, Decimal] = {}
    for usage in edge_usage_list:
        edge_totals[usage.edge_band] = (
            edge_totals.get(usage.edge_band, ZERO) + usage.length_meters
        )

    edge_lines = tuple(
        EdgeCostLine(
            edge_band=edge_band,
            length_meters=length_meters,
            cost_rub=length_meters * edge_band.price_per_meter_rub,
        )
        for edge_band, length_meters in edge_totals.items()
    )

    hardware_totals: dict[HardwareItem, int] = {}
    for usage in hardware_usage_list:
        hardware_totals[usage.item] = (
            hardware_totals.get(usage.item, 0) + usage.quantity
        )

    hardware_lines = tuple(
        HardwareCostLine(
            item=item,
            quantity=quantity,
            cost_rub=item.unit_price_rub * Decimal(quantity),
        )
        for item, quantity in hardware_totals.items()
    )

    materials_cost = sum(
        (line.preliminary_cost_rub for line in material_lines), start=ZERO
    )
    edges_cost = sum((line.cost_rub for line in edge_lines), start=ZERO)
    hardware_cost = sum((line.cost_rub for line in hardware_lines), start=ZERO)

    return Estimate(
        material_lines=material_lines,
        edge_lines=edge_lines,
        hardware_lines=hardware_lines,
        total_part_count=sum(part.quantity for part in part_list),
        total_parts_area_square_meters=sum(
            (part.area_square_meters for part in part_list), start=ZERO
        ),
        materials_cost_rub=materials_cost,
        edges_cost_rub=edges_cost,
        hardware_cost_rub=hardware_cost,
        total_cost_rub=materials_cost + edges_cost + hardware_cost,
    )
