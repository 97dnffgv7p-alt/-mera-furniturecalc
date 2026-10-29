"""Версионируемые JSON-проекты и атомарная запись локального черновика."""
from copy import deepcopy
import json
import os
from pathlib import Path
from uuid import uuid4
from datetime import date
from furniturecalc.domain.order import ValidationError, unique

FORMAT = 'furniturecalc-order-1'


def empty_state():
    return dict(format=FORMAT, catalog=[], order=dict(id=uuid4().hex, number='', date=date.today().isoformat(), client='', conditions='',
        products=[], expenses=[], expenses_confirmed=False,
        settings=dict(reserve_pct='0', overhead_pct='0', pricing_mode='markup', pricing_pct='0', discount_pct='0', vat_mode='none', vat_pct='0')))


def validate_state(state):
    if not isinstance(state, dict) or state.get('format') != FORMAT:
        raise ValidationError('Неподдерживаемый формат проекта; ожидается furniturecalc-order-1')
    order = state.get('order')
    if not isinstance(order, dict) or not isinstance(order.get('settings'), dict):
        raise ValidationError('Нет заказа или настроек')
    unique(state.get('catalog'), 'Каталог')
    unique(order.get('products'), 'Изделия')
    unique(order.get('expenses'), 'Расходы')
    for p in order['products']:
        for collection in ('parts', 'hardware', 'work'):
            unique(p.get(collection), f'{p["id"]}.{collection}')
    return deepcopy(state)


def loads(data):
    try:
        return validate_state(json.loads(data, parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x))))
    except (ValueError, TypeError) as exc:
        raise ValidationError(f'Неверный JSON проекта: {exc}') from exc


def dumps(state):
    return json.dumps(validate_state(state), ensure_ascii=False, indent=2, allow_nan=False)


def save(path, state):
    content = dumps(state)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    try:
        with temp.open('x', encoding='utf-8') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def load(path):
    return loads(Path(path).read_text(encoding='utf-8'))
