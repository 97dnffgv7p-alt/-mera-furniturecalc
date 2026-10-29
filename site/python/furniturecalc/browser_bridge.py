"""JSON-граница WebAssembly-клиента. Формулы остаются в domain/order.py."""
import base64
import json
from furniturecalc.domain.order import ValidationError, calculate_order, refresh_prices
from furniturecalc.storage import validate_state
from furniturecalc.table_import import import_catalog, import_specification


def dispatch(raw):
    try:
        request = json.loads(raw)
        action, payload = request['action'], request['payload']
        if action == '/api/import-price':
            result = {'catalog': import_catalog(base64.b64decode(payload['data'], validate=True), payload['filename'])}
        elif action == '/api/import-spec':
            result = {'state': import_specification(base64.b64decode(payload['data'], validate=True), payload['filename'], payload['catalog'])}
        else:
            state = validate_state(payload)
            if action == '/api/calculate':
                result = {'result': calculate_order(state['order'])}
            elif action == '/api/refresh-prices':
                state['order'] = refresh_prices(state['order'], state['catalog'])
                result = {'state': state}
            elif action in ('/api/validate', '/api/save'):
                result = {'state': state}
            else:
                raise ValidationError('Неизвестная операция')
        return json.dumps({'ok': True, 'data': result}, ensure_ascii=False, allow_nan=False)
    except (ValueError, TypeError, KeyError, AttributeError, OSError) as exc:
        return json.dumps({'ok': False, 'errors': getattr(exc, 'errors', [str(exc)])}, ensure_ascii=False)
