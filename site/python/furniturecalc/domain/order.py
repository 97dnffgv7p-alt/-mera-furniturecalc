"""Заказ и коммерческий расчёт. Существующее ядро площади сохраняет свой API."""
from copy import deepcopy
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext, ROUND_HALF_UP, ROUND_FLOOR
import re
from .models import Material, Part
from .calculations import calculate_estimate

SIDES = ('length1', 'length2', 'width1', 'width2')
UNITS = ('sheet', 'm2', 'm', 'piece', 'set', 'hour')
KINDS = ('sheet', 'material', 'edge', 'hardware', 'work', 'expense')
CENT = Decimal('0.01')


class ValidationError(ValueError):
    def __init__(self, errors):
        self.errors = errors if isinstance(errors, list) else [str(errors)]
        super().__init__('; '.join(self.errors))


def number(value, path, *, positive=False, integer=False, maximum=Decimal('1000000000000')):
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValidationError(f'{path}: требуется число; неизвестное не равно нулю')
    raw = str(value).strip().replace(',', '.')
    if not re.fullmatch(r'-?\d+(?:\.\d+)?', raw) or len(raw) > 40:
        raise ValidationError(f'{path}: неверное десятичное число')
    n = Decimal(raw)
    if not n.is_finite() or n < 0 or (positive and n == 0) or n > maximum:
        raise ValidationError(f'{path}: число вне допустимого диапазона')
    if integer and n != n.to_integral_value():
        raise ValidationError(f'{path}: требуется целое количество')
    return n


def text(value, path):
    if not isinstance(value, str) or not value.strip() or len(value) > 10000:
        raise ValidationError(f'{path}: заполните текст')
    return value.strip()


def valid_date(value, path):
    try:
        date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError(f'{path}: дата должна быть ГГГГ-ММ-ДД')


def unique(rows, path):
    if not isinstance(rows, list):
        raise ValidationError(f'{path}: ожидается список')
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValidationError(f'{path}: неверная строка')
        ident = text(row.get('id'), f'{path}.id')
        if ident in seen:
            raise ValidationError(f'{path}: повтор ID {ident}')
        seen.add(ident)


def price(item, path, expected_kind=None, expected_unit=None):
    if not isinstance(item, dict):
        raise ValidationError(f'{path}: выберите позицию и зафиксируйте цену')
    for key in ('id', 'name', 'source', 'revision'):
        text(item.get(key), f'{path}.{key}')
    valid_date(item.get('date'), f'{path}.date')
    if item.get('kind') not in KINDS or item.get('unit') not in UNITS:
        raise ValidationError(f'{path}: неизвестный тип или единица')
    if expected_kind and item['kind'] not in expected_kind:
        raise ValidationError(f'{path}: несовместимый тип {item["kind"]}')
    if expected_unit and item['unit'] != expected_unit:
        raise ValidationError(f'{path}: требуется {expected_unit}, получено {item["unit"]}')
    rate = number(item.get('price'), f'{path}.price')
    if item['kind'] == 'sheet':
        if item['unit'] != 'sheet':
            raise ValidationError(f'{path}: цена должна быть за лист')
        for key in ('length_mm', 'width_mm', 'thickness_mm'):
            number(item.get(key), f'{path}.{key}', positive=True)
    if item['kind'] == 'edge' and item['unit'] != 'm':
        raise ValidationError(f'{path}: кромка тарифицируется в м')
    if item['kind'] == 'material' and item['unit'] != 'm2':
        raise ValidationError(f'{path}: материал тарифицируется в м²')
    return rate


def convert_quantity(value, source_unit, target_unit):
    q = number(value, 'Расход', positive=True)
    if source_unit == target_unit:
        return q
    if (source_unit, target_unit) == ('mm', 'm'):
        return q / 1000
    if (source_unit, target_unit) == ('min', 'hour'):
        return q / 60
    raise ValidationError(f'Единицы {source_unit} и {target_unit} несовместимы; комплект не равен штуке')


def money(n):
    return n.quantize(CENT, rounding=ROUND_HALF_UP)


def reconcile(values):
    """Копейки распределяются по наибольшим остаткам, при равенстве — по порядку строк."""
    if not values:
        return []
    shown = [n.quantize(CENT, rounding=ROUND_FLOOR) for n in values]
    cents = int((money(sum(values)) - sum(shown)) / CENT)
    indices = sorted(range(len(values)), key=lambda i: (-(values[i] - shown[i]), i))
    for i in indices[:cents]:
        shown[i] += CENT
    return shown


def refresh_prices(order, catalog):
    unique(catalog, 'Каталог')
    mapping = {p['id']: p for p in catalog}
    updated = deepcopy(order)

    def replace(old, where):
        if old is None:
            return None
        ident = old.get('id')
        if ident not in mapping:
            raise ValidationError(f'{where}: нет ID {ident}; подстановка по названию запрещена')
        new = mapping[ident]
        price(new, where)
        if new['unit'] != old.get('unit') or new['kind'] != old.get('kind'):
            raise ValidationError(f'{where}: изменены тип или единица позиции {ident}')
        return deepcopy(new)

    for p in updated.get('products', []):
        for part in p.get('parts', []):
            part['material'] = replace(part.get('material'), part['id'])
            part['edges'] = {s: replace(part.get('edges', {}).get(s), part['id'] + '.' + s) for s in SIDES}
        for row in p.get('hardware', []) + p.get('work', []):
            row['resource'] = replace(row.get('resource'), row['id'])
    for row in updated.get('expenses', []):
        row['resource'] = replace(row.get('resource'), row['id'])
    return updated


def calculate_order(order, final=False):
    try:
        with localcontext() as context:
            context.prec = 28
            context.rounding = ROUND_HALF_UP
            return _calculate(order, final)
    except (KeyError, TypeError, AttributeError, InvalidOperation) as exc:
        raise ValidationError(f'Структура заказа неполна или неверна: {exc}') from exc


def _calculate(o, final):
    text(o.get('id'), 'Заказ.id')
    if final:
        for key in ('number', 'client', 'conditions'):
            text(o.get(key), f'Заказ.{key}')
        valid_date(o.get('date'), 'Заказ.date')
    s = o.get('settings', {})
    pct = {k: number(s.get(k), f'Настройки.{k}', maximum=Decimal('1000'))
           for k in ('reserve_pct', 'overhead_pct', 'pricing_pct', 'discount_pct', 'vat_pct')}
    if pct['discount_pct'] > 100 or pct['vat_pct'] > 100:
        raise ValidationError('Скидка и НДС должны быть от 0 до 100%')
    mode, vat = s.get('pricing_mode'), s.get('vat_mode')
    if mode not in ('markup', 'margin') or vat not in ('none', 'add', 'included'):
        raise ValidationError('Выберите режим цены и НДС')
    if mode == 'margin' and pct['pricing_pct'] >= 100:
        raise ValidationError('Целевая маржа должна быть меньше 100%')
    unique(o.get('products'), 'Изделия')
    if not o['products']:
        raise ValidationError('Добавьте хотя бы одно изделие')
    unique(o.get('expenses'), 'Расходы заказа')
    if o.get('expenses_confirmed') is not True:
        raise ValidationError('Подтвердите состав доставки, монтажа и дополнительных расходов')
    reserve = 1 + pct['reserve_pct'] / 100
    lines, products, quote = [], [], []

    def line(ident, pid, kind, label, q, rate, snap, detail, clean=None):
        raw = q * rate
        lines.append(dict(id=ident, product_id=pid, kind=kind, name=label, resource_id=snap['id'],
                          quantity=str(q), unit='m2' if kind == 'material' else snap['unit'], rate=str(rate),
                          raw_amount=str(raw), snapshot=deepcopy(snap), detail=detail,
                          clean_quantity=None if clean is None else str(clean)))
        return raw

    def usages(rows, pid, count, kind):
        unique(rows, f'{pid}.{kind}')
        total = Decimal(0)
        for row in rows:
            snap = row.get('resource')
            rate = price(snap, f'{pid}.{row["id"]}', (kind,))
            q = convert_quantity(row.get('quantity'), row.get('unit'), snap['unit'])
            if snap['unit'] in ('piece', 'set') and q != q.to_integral_value():
                raise ValidationError(f'{row["id"]}: количество шт./комплектов должно быть целым')
            total += line(f'{pid}:{row["id"]}', pid, kind, snap['name'], q * count, rate, snap,
                          f'{row["quantity"]} {row["unit"]} на изделие × {count} изделий')
        return total

    def selling(cost):
        value = cost * (1 + pct['overhead_pct'] / 100)
        return value * (1 + pct['pricing_pct'] / 100) if mode == 'markup' else value / (1 - pct['pricing_pct'] / 100)

    for p in o['products']:
        pid = p['id']
        for key in ('name', 'code'):
            text(p.get(key), f'{pid}.{key}')
        count = number(p.get('quantity'), f'{pid}.quantity', positive=True, integer=True, maximum=Decimal('100000'))
        for key in ('length_mm', 'width_mm', 'height_mm'):
            number(p.get(key), f'{pid}.{key}', positive=True)
        if p.get('composition_confirmed') is not True:
            raise ValidationError(f'{p["name"]}: подтвердите полноту деталей, фурнитуры и работ')
        unique(p.get('parts'), f'{pid}.parts')
        if not p['parts']:
            raise ValidationError(f'{pid}: нет деталей')
        direct = Decimal(0)
        for part in p['parts']:
            path = f'{pid}:{part["id"]}'
            text(part.get('name'), path)
            length = number(part.get('length_mm'), path + '.length_mm', positive=True)
            width = number(part.get('width_mm'), path + '.width_mm', positive=True)
            qty = number(part.get('quantity'), path + '.quantity', positive=True, integer=True)
            snap = part.get('material')
            rate = price(snap, path + '.material', ('sheet', 'material'))
            if snap['kind'] == 'sheet':
                mat = Material(snap['name'], number(snap['thickness_mm'], path), number(snap['length_mm'], path), number(snap['width_mm'], path), rate)
                if any(a > b for a, b in zip(sorted((length, width)), sorted((mat.sheet_length_mm, mat.sheet_width_mm)))):
                    raise ValidationError(f'{path}: деталь не помещается в лист даже без пропила')
                old = calculate_estimate([Part(part['name'], mat, length, width, int(qty))])
                area, rate = old.total_parts_area_square_meters * count, mat.preliminary_price_per_square_meter_rub
            else:
                area = length * width * qty * count / 1000000
            direct += line(path + ':material', pid, 'material', part['name'] + ' / ' + snap['name'], area * reserve,
                           rate, snap, f'{length}×{width} мм × {qty} деталей × {count} изделий; запас {pct["reserve_pct"]}%', area)
            if part.get('edges_confirmed') is not True or set(part.get('edges', {})) != set(SIDES):
                raise ValidationError(f'{path}: подтвердите кромление всех четырёх сторон')
            for side in SIDES:
                edge = part['edges'][side]
                if edge is not None:
                    erate = price(edge, path + '.' + side, ('edge',), 'm')
                    q = (length if side.startswith('length') else width) * qty * count / 1000
                    direct += line(path + ':' + side, pid, 'edge', part['name'] + ' / ' + side + ' / ' + edge['name'], q, erate, edge,
                                   f'Сторона {side}; {qty} деталей × {count} изделий')
        direct += usages(p.get('hardware'), pid, count, 'hardware')
        direct += usages(p.get('work'), pid, count, 'work')
        unit_price = money(selling(direct) / count)
        quote.append(dict(id=pid, code=p['code'], name=p['name'], quantity=str(count), unit='piece', unit_price=str(unit_price), amount=str(unit_price * count)))
        products.append(dict(id=pid, name=p['name'], quantity=str(count), raw_direct=str(direct), unit_price=str(unit_price), sale=str(unit_price * count)))
    for row in o['expenses']:
        if row.get('kind') not in ('delivery', 'installation', 'other'):
            raise ValidationError(f'{row["id"]}: выберите доставку, монтаж или прочий расход')
        snap = row.get('resource')
        rate = price(snap, row['id'], ('expense', 'work'))
        q = convert_quantity(row.get('quantity'), row.get('unit'), snap['unit'])
        if snap['unit'] in ('piece', 'set') and q != q.to_integral_value():
            raise ValidationError(f'{row["id"]}: количество должно быть целым')
        line('order:' + row['id'], None, row['kind'], snap['name'], q, rate, snap, 'На весь заказ, без умножения на изделия')
        unit_price = money(selling(rate))
        quote.append(dict(id='order:' + row['id'], code=row['kind'], name=snap['name'], quantity=str(q), unit=snap['unit'], unit_price=str(unit_price), amount=str(money(unit_price * q))))
    for record, amount in zip(lines, reconcile([Decimal(x['raw_amount']) for x in lines])):
        record['amount'], record['rounding_adjustment'] = str(amount), str(amount - Decimal(record['raw_amount']))
    for p in products:
        p['direct'] = str(sum((Decimal(x['amount']) for x in lines if x['product_id'] == p['id']), Decimal('0.00')))
    direct = sum((Decimal(x['raw_amount']) for x in lines), Decimal(0))
    cost = direct * (1 + pct['overhead_pct'] / 100)
    sale = sum((Decimal(x['amount']) for x in quote), Decimal('0.00'))
    discount = money(sale * pct['discount_pct'] / 100)
    after = sale - discount
    tax = money(after * pct['vat_pct'] / 100) if vat == 'add' else money(after * pct['vat_pct'] / (100 + pct['vat_pct'])) if vat == 'included' else Decimal('0.00')
    payable = after + tax if vat == 'add' else after
    totals = dict(raw_direct=str(direct), direct=str(money(direct)), overhead=str(money(cost) - money(direct)), cost=str(money(cost)), raw_cost=str(cost),
                  sale=str(sale), discount=str(discount), after_discount=str(after), tax=str(tax), net=str(payable - tax), payable=str(payable))
    return dict(engine_version='order-1.0', lines=lines, products=products, quote_lines=quote, totals=totals, settings=deepcopy(s),
                note='Материалы по площади предварительно; не раскрой и не количество листов к закупке.')
