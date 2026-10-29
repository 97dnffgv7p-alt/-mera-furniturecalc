'use strict';
const token = document.querySelector('meta[name="app-token"]').content;
const cacheKey = 'furniturecalc-draft-' + document.querySelector('meta[name="workspace"]').content;
const units = {sheet:'лист',m2:'м²',m:'п.м',piece:'шт.',set:'комплект',hour:'ч',mm:'мм',min:'мин'};
const kinds = {sheet:'Листовой материал',material:'Материал по площади',edge:'Кромка',hardware:'Фурнитура',work:'Работа',expense:'Дополнительный расход'};
const sides = {length1:'Длина · сторона 1',length2:'Длина · сторона 2',width1:'Ширина · сторона 1',width2:'Ширина · сторона 2'};
let state, revision = 0, timer, saveChain = Promise.resolve(), selectedTab = 'order', lastResult = null, calculationError = false, importPreview = null;
const $ = id => document.getElementById(id);
const copy = value => JSON.parse(JSON.stringify(value));
const id = () => crypto.randomUUID();
const today = () => {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const get = path => path.split('.').reduce((obj,key) => obj?.[key], state);
function set(path,value) {const keys=path.split('.'),last=keys.pop(); keys.reduce((obj,key)=>obj[key],state)[last]=value;}
function rub(value) {if(value===null || value===undefined || value==='') return '— ₽'; const [whole,fraction]=String(value).split('.'); return esc(whole.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(fraction?','+fraction:''))+' ₽';}
function field(label,path,type='text') {return `<label>${esc(label)}<input type="${type}" data-bind="${esc(path)}" value="${esc(get(path))}" ${type==='text'?'autocomplete="off"':''}></label>`;}
function area(label,path) {return `<label class="wide">${esc(label)}<textarea data-bind="${esc(path)}">${esc(get(path))}</textarea></label>`;}
function select(label,path,options) {return `<label>${esc(label)}<select data-bind="${esc(path)}">${Object.entries(options).map(([v,n])=>`<option value="${esc(v)}" ${get(path)===v?'selected':''}>${esc(n)}</option>`).join('')}</select></label>`;}
function check(label,path) {return `<label class="check"><input type="checkbox" data-bind="${esc(path)}" ${get(path)===true?'checked':''}>${esc(label)}</label>`;}
function button(label,action,path='',extra='') {return `<button data-action="${action}" data-path="${esc(path)}" ${extra}>${esc(label)}</button>`;}
function resource(label,path,allowed,empty='Выберите позицию') {
  const snap=get(path), candidates=state.catalog.filter(x=>allowed.includes(x.kind));
  let options=`<option value="">${esc(empty)}</option>`;
  if(snap && !candidates.some(x=>x.id===snap.id)) options+=`<option value="${esc(snap.id)}" selected>${esc(snap.name)} (сохранённая позиция)</option>`;
  options+=candidates.map(x=>`<option value="${esc(x.id)}" ${snap?.id===x.id?'selected':''}>${esc(x.name || 'Без названия')} · ${esc(x.sku)}</option>`).join('');
  const info = snap ? `<div class="price-info">Снимок: <strong>${rub(snap.price)} / ${esc(units[snap.unit] || snap.unit)}</strong>${snap.kind==='sheet'?` · ${esc(snap.length_mm)} × ${esc(snap.width_mm)} × ${esc(snap.thickness_mm)} мм`:''}<br>${esc(snap.source)} · ${esc(snap.date)}</div>` : '';
  return `<div><label>${esc(label)}<select data-resource="${esc(path)}">${options}</select></label>${info}</div>`;
}
async function api(url,payload) {
  if(window.furnitureBackend) return window.furnitureBackend.request(url,payload);
  const response=await fetch(url,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-FurnitureCalc-Token':token},body:JSON.stringify(payload)});
  const data=await response.json();
  if(!response.ok) throw new Error((data.errors || ['Ошибка сервера']).map(friendly).join('\n'));
  return data;
}
function friendly(message) {
  const labels={length_mm:'длина (мм)',width_mm:'ширина (мм)',height_mm:'высота (мм)',quantity:'количество',price:'цена',thickness_mm:'толщина (мм)',material:'материал',source:'источник цены',revision:'версия цены',date:'дата',name:'название',code:'код',reserve_pct:'запас (%)',overhead_pct:'накладные (%)',pricing_pct:'наценка / маржа (%)',discount_pct:'скидка (%)',vat_pct:'НДС (%)'};
  let result=String(message);
  for(const p of state?.order?.products || []) {
    result=result.split(p.id).join(p.name || 'Изделие без названия');
    for(const r of [...p.parts,...p.hardware,...p.work]) result=result.split(r.id).join(r.name || r.resource?.name || 'Новая строка');
  }
  return result.replace(/\b(length_mm|width_mm|height_mm|quantity|price|thickness_mm|material|source|revision|date|name|code|reserve_pct|overhead_pct|pricing_pct|discount_pct|vat_pct)\b/g,key=>labels[key]);
}
function message(text) {$('message').textContent=text; $('message').hidden=!text;}
function tab(name) {selectedTab=name; for(const t of ['order','catalog','result']) $(t+'-panel').hidden=t!==name; document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===name)); $('workspace').classList.toggle('catalog-view',name==='catalog');}
function itemCount() {
  const values=state.order.products.map(p=>String(p.quantity ?? '').trim());
  return values.every(v=>/^\d+$/.test(v) && v.length<=12 && BigInt(v)>0n) ? String(values.reduce((n,v)=>n+BigInt(v),0n)) : 'Не задано';
}
function updateDashboard() {
  if(!state) return;
  const count=itemCount(), totals=lastResult?.totals;
  $('catalog-count').textContent=state.catalog.length;
  $('metric-products').textContent=state.order.products.length+' / '+count;
  $('metric-parts').textContent=state.order.products.reduce((n,p)=>n+p.parts.length,0);
  $('metric-catalog').textContent=state.catalog.length;
  $('metric-validation').textContent=totals?'Проверено':calculationError?'Есть ошибки':'Ожидает';
  $('metric-validation-note').textContent=totals?'расчёт выполнен по введённым данным':'неизвестное значение не равно нулю';
  $('hero-payable').innerHTML=rub(totals?.payable);
  $('hero-status').textContent=totals?'Расчёт актуален':calculationError?'Исправьте данные':'Выполните расчёт';
  $('calculation-status').textContent=totals?'Расчёт актуален':calculationError?'Расчёт заблокирован':'Требуется расчёт';
  $('calculation-hint').textContent=totals?'Все строки заказа учтены. Подробности — в разделе «Детализация».':'Проверьте состав изделий и ставки. Предыдущие суммы скрыты.';
  $('calculate-bar').classList.toggle('ready',!!totals);
  $('calculate-bar').classList.toggle('dirty',!totals);
  const line=(label,value)=>`<div><span>${esc(label)}</span><b>${value}</b></div>`;
  $('summary-content').innerHTML=`<div class="summary-lines">${line('Позиций',String(state.order.products.length))}${line('Изделий всего',esc(count))}${line('До скидки',rub(totals?.sale))}${line('Скидка',rub(totals?.discount))}${line('После скидки',rub(totals?.after_discount))}${line('НДС',rub(totals?.tax))}</div><div class="final"><span>ИТОГО К ОПЛАТЕ</span><strong>${rub(totals?.payable)}</strong><small>${totals?esc({none:'Без НДС',add:'НДС начислен сверху',included:'НДС включён в цену'}[lastResult.settings.vat_mode]):'Итог появится после успешного расчёта'}</small></div>`;
  const overview=$('product-overview');
  if(overview) overview.innerHTML=overviewRows();
}
function overviewRows() {
  return state.order.products.map((p,i)=>{const calculated=lastResult?.products.find(x=>x.id===p.id);return `<tr><td><b>${esc(p.name || 'Новое изделие')}</b><small>${esc(p.code || 'Код не задан')}</small></td><td>${esc(p.length_mm || '?')} × ${esc(p.width_mm || '?')} × ${esc(p.height_mm || '?')}<small>мм · габариты</small></td><td class="num">${esc(p.quantity || '?')}</td><td>${button('Состав · '+p.parts.length+' строк','edit-product','order.products.'+i,'class="composition-button"')}</td><td class="num">${rub(calculated?.unit_price)}</td><td class="num"><b>${rub(calculated?.sale)}</b></td></tr>`;}).join('') || '<tr><td colspan="6">Добавьте первое изделие, чтобы начать расчёт.</td></tr>';
}
function changed() {
  revision++;
  lastResult=null; calculationError=false;
  message('');
  $('result-panel').innerHTML='<div class="empty">Данные изменены. Нажмите «Рассчитать заказ», чтобы получить актуальный результат.</div>';
  updateDashboard();
  try {localStorage.setItem(cacheKey,JSON.stringify(state)); $('save-status').textContent='Сохранение…';} catch { $('save-status').textContent='Ожидание записи на диск…'; }
  clearTimeout(timer); timer=setTimeout(queueSave,400);
}
function queueSave() {
  const snapshot=copy(state), current=revision;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    try {await api('/api/save',snapshot); if(current===revision) {localStorage.removeItem(cacheKey); $('save-status').textContent=window.furnitureBackend?'Черновик сохранён в этом браузере':'Черновик сохранён на компьютере';}}
    catch(error) {if(current===revision) {$('save-status').textContent='Не сохранено на диск'; message('Не удалось сохранить черновик. Сохраните его в файл.\n'+error.message);}}
  });
  return saveChain;
}
function partCard(part,path) {
  return `<div class="subcard"><div class="row-head"><strong>Деталь</strong><div class="actions">${button('Копировать','copy',path)}${button('Удалить','remove',path,'class="danger"')}</div></div>
    <div class="grid">${field('Название детали',path+'.name')}${field('Длина, мм',path+'.length_mm')}${field('Ширина, мм',path+'.width_mm')}${field('Деталей на одно изделие, шт.',path+'.quantity')}${resource('Материал',path+'.material',['sheet','material'])}</div>
    <p class="hint">Кромка: выберите материал для каждой стороны. «Без кромки» означает отсутствие кромления после подтверждения ниже.</p>
    <div class="grid">${Object.entries(sides).map(([s,n])=>resource(n,path+'.edges.'+s,['edge'],'Без кромки')).join('')}</div>
    ${check('Все четыре стороны проверены',path+'.edges_confirmed')}</div>`;
}
function usageRows(rows,path,kind) {
  return rows.map((row,i)=>{const base=path+'.'+i; return `<div class="subcard"><div class="grid">${resource('Позиция',base+'.resource',[kind])}${field('Расход на одно изделие',base+'.quantity')}${select('Единица расхода',base+'.unit',units)}</div>${button('Удалить строку','remove',base,'class="danger inline-button"')}</div>`;}).join('')+button(kind==='hardware'?'Добавить фурнитуру':'Добавить работу','usage',path,`data-kind="${kind}"`);
}
function renderOrder() {
  const o=state.order;
  $('order-panel').innerHTML=`<section class="panel"><div class="panel-head"><div><p class="kicker">01 · ИЗДЕЛИЯ</p><h2>Полный расчёт проекта</h2></div>${button('＋ Добавить','product')}</div><div class="table-wrap"><table class="overview-table"><thead><tr><th>Изделие</th><th>Размер</th><th class="num">Кол-во</th><th>Состав</th><th class="num">Цена / шт.</th><th class="num">Сумма</th></tr></thead><tbody id="product-overview">${overviewRows()}</tbody></table></div><div class="method"><b>Основание цены</b><span>Детали, кромка, фурнитура и работы по сохранённым ставкам. Цены в таблице — до скидки и начисляемого сверху НДС.</span></div></section>
    <details class="card" data-fold="order-metadata"><summary>Параметры заказа и клиент</summary><div class="grid">${field('Номер заказа','order.number')}${field('Дата','order.date','date')}${field('Клиент','order.client')}${area('Условия, сроки, примечания','order.conditions')}</div></details>
    <p class="section-label">Состав изделий · редактирование</p>
    ${o.products.map((p,i)=>{const path='order.products.'+i;return `<details class="card product-editor" data-fold="${esc(p.id)}"><summary>${esc(p.name || 'Новое изделие')} · ${esc(p.quantity || '?')} шт.</summary><div class="actions inline-button">${button('Копировать изделие','copy',path)}${button('Удалить изделие','remove',path,'class="danger"')}</div>
      <div class="grid">${field('Название',path+'.name')}${field('Код / артикул',path+'.code')}${field('Количество изделий, шт.',path+'.quantity')}${field('Ширина изделия, мм',path+'.length_mm')}${field('Глубина изделия, мм',path+'.width_mm')}${field('Высота изделия, мм',path+'.height_mm')}</div>
      <h3>Детали и кромка</h3><p class="hint">Размеры деталей вводятся отдельно от габаритов. Количество деталей и расход ниже задаются на одно изделие.</p>
      ${p.parts.map((part,j)=>partCard(part,path+'.parts.'+j)).join('')}${button('Добавить деталь','part',path+'.parts')}
      <h3>Фурнитура</h3>${usageRows(p.hardware,path+'.hardware','hardware')}
      <h3>Работы</h3>${usageRows(p.work,path+'.work','work')}
      ${check('Состав деталей, фурнитуры и работ полный и проверен',path+'.composition_confirmed')}</details>`;}).join('')}
    ${button('＋ Добавить изделие','product')}
    <div class="card inline-button"><h2>Доставка, монтаж и другие расходы</h2><p class="hint">Расходы на весь заказ. На количество изделий повторно не умножаются.</p>
    ${o.expenses.map((r,i)=>{const path='order.expenses.'+i;return `<div class="subcard"><div class="grid">${select('Вид расхода',path+'.kind',{delivery:'Доставка',installation:'Монтаж',other:'Прочее'})}${resource('Позиция',path+'.resource',['expense','work'])}${field('Расход на заказ',path+'.quantity')}${select('Единица',path+'.unit',units)}</div>${button('Удалить расход','remove',path,'class="danger inline-button"')}</div>`;}).join('')}
    ${button('Добавить расход','expense')}${check('Доставка, монтаж и прочие расходы проверены (в том числе их отсутствие)','order.expenses_confirmed')}</div>
    <div class="card"><h2>Правила расчёта</h2><p class="hint">Укажите свои проценты. Ноль означает явно выбранное отсутствие начисления, пустое поле — неизвестное значение.</p><div class="grid">
    ${field('Запас материала, %','order.settings.reserve_pct')}${field('Накладные расходы, %','order.settings.overhead_pct')}${select('Режим цены','order.settings.pricing_mode',{markup:'Наценка на себестоимость',margin:'Целевая маржа от цены'})}${field('Наценка / маржа, %','order.settings.pricing_pct')}${field('Скидка, %','order.settings.discount_pct')}${select('Режим НДС','order.settings.vat_mode',{none:'Без НДС',add:'Начисляется сверху',included:'Включён в цену'})}${field('Ставка НДС, %','order.settings.vat_pct')}</div>
    <p class="hint">Порядок: материал с запасом + кромка + фурнитура + работы + расходы → накладные → наценка или маржа → скидка → НДС. Запас применяется только к площади материала. Накладные и наценка применяются также к доставке и монтажу.</p></div>`;
}
function renderCatalog() {
  $('catalog-panel').innerHTML=`<div class="card"><h2>Каталог цен</h2><p>Отредактируйте ставки здесь, затем выберите позиции в изделиях. Уже выбранные позиции сохраняют собственные снимки цен.</p><div class="actions">${button('Добавить позицию','catalog')}${button('Обновить цены текущего заказа','refresh')}</div><p class="hint">Обновление выполняется только по точному ID. При пропусках или несовместимых единицах заказ останется прежним.</p></div>
  ${state.catalog.map((item,i)=>{const p='catalog.'+i;return `<details class="card" data-fold="catalog-${esc(item.id)}"><summary>${esc(item.name || 'Новая позиция')} · ${rub(item.price)} / ${esc(units[item.unit])}</summary><p class="hint">ID: ${esc(item.id)}</p><div class="grid">${field('Название',p+'.name')}${field('Артикул',p+'.sku')}${select('Тип позиции',p+'.kind',kinds)}${select('Единица цены',p+'.unit',Object.fromEntries(Object.entries(units).filter(([k])=>!['mm','min'].includes(k))))}${field('Цена, руб.',p+'.price')}${field('Источник цены',p+'.source')}${field('Дата цены',p+'.date','date')}${field('Версия цены',p+'.revision')}${item.kind==='sheet'?field('Длина листа, мм',p+'.length_mm')+field('Ширина листа, мм',p+'.width_mm')+field('Толщина, мм',p+'.thickness_mm'):''}</div>${button('Удалить из каталога','remove',p,'class="danger inline-button"')}</details>`;}).join('')}`;
}
function render() {
  const folds = new Map([...document.querySelectorAll('[data-fold]')].map(el=>[el.dataset.fold,el.open]));
  renderOrder(); renderCatalog();
  updateDashboard();
  document.querySelectorAll('[data-fold]').forEach(el=>{if(folds.has(el.dataset.fold)) el.open=folds.get(el.dataset.fold);});
  tab(selectedTab);
}
function showResult(r) {
  lastResult=r; calculationError=false; updateDashboard();
  const t=r.totals;
  const metrics=[['Прямые затраты',t.direct],['Себестоимость',t.cost],['НДС',t.tax],['К оплате',t.payable]];
  $('result-panel').innerHTML=`<div class="totals">${metrics.map(([n,v],i)=>`<div class="metric ${i===3?'pay':''}"><span>${n}</span><strong>${rub(v)}</strong></div>`).join('')}</div>
  <div class="card"><h2>Цена заказа</h2><div class="table-wrap"><table><thead><tr><th>Изделие / расход</th><th class="num">Количество</th><th class="num">Цена единицы</th><th class="num">Сумма</th></tr></thead><tbody>${r.quote_lines.map(x=>`<tr><td>${esc(x.name)}</td><td class="num">${esc(x.quantity)} ${esc(units[x.unit])}</td><td class="num">${rub(x.unit_price)}</td><td class="num">${rub(x.amount)}</td></tr>`).join('')}</tbody></table></div>
  <p>До скидки: <b>${rub(t.sale)}</b> · Скидка: <b>${rub(t.discount)}</b> · После скидки: <b>${rub(t.after_discount)}</b></p><p>НДС: ${rub(t.tax)} (${esc({none:'не применяется',add:'начисляется сверху',included:'включён в цену'}[r.settings.vat_mode])}). К оплате: <b>${rub(t.payable)}</b>.</p></div>
  <div class="card"><h2>Из чего складывается себестоимость</h2><div class="table-wrap"><table><thead><tr><th>Составляющая</th><th class="num">Расход</th><th class="num">Ставка, руб.</th><th class="num">Сумма</th></tr></thead><tbody>${r.lines.map(x=>`<tr><td>${esc(x.name.replace(/length1/g,'длина 1').replace(/length2/g,'длина 2').replace(/width1/g,'ширина 1').replace(/width2/g,'ширина 2'))}<div class="breakdown">${esc(r.products.find(p=>p.id===x.product_id)?.name || 'На весь заказ')}<br>${esc(x.detail)}<br>Источник: ${esc(x.snapshot.source)} · ${esc(x.snapshot.date)}${x.clean_quantity!==null?`<br>Площадь деталей без запаса: ${esc(x.clean_quantity)} м²`:''}</div></td><td class="num">${esc(x.quantity)} ${esc(units[x.unit])}</td><td class="num">${esc(x.rate)}</td><td class="num">${rub(x.amount)}</td></tr>`).join('')}</tbody></table></div>
  <p>Прямые затраты ${rub(t.direct)} + накладные ${rub(t.overhead)} = себестоимость <b>${rub(t.cost)}</b>.</p>
  <p class="hint">${esc(r.note)} Денежные формулы выполняются в Python через Decimal. Копейки в детализации распределяются по наибольшим остаткам до совпадения с итогом прямых затрат. Цена единицы продажи округляется до копеек, затем умножается на количество. Скидка и НДС округляются отдельно.</p></div>`;
}
function newPart() {return {id:id(),name:'',length_mm:'',width_mm:'',quantity:'1',material:null,edges:Object.fromEntries(Object.keys(sides).map(s=>[s,null])),edges_confirmed:false};}
async function action(name,path,element) {
  if(!state) return;
  if(name==='import-price' || name==='import-spec') {$(name==='import-price'?'price-file':'spec-file').click();return;}
  if(name==='cancel-import') {$('import-dialog').close();importPreview=null;return;}
  if(name==='apply-import') {
    if(!importPreview || importPreview.revision!==revision) throw new Error('Данные изменились. Откройте файл повторно.');
    if(importPreview.kind==='price') {state.catalog=importPreview.data.catalog;selectedTab='catalog';}
    else {state=importPreview.data.state;selectedTab='order';}
    $('import-dialog').close();importPreview=null;changed();render();return;
  }
  if(name==='edit-product') {tab('order'); const product=get(path); const editor=[...document.querySelectorAll('.product-editor')].find(el=>el.dataset.fold===product.id); if(editor) {editor.open=true; editor.scrollIntoView({block:'start'}); editor.querySelector('input')?.focus({preventScroll:true});} return;}
  if(name==='calculate') {
    const current=revision; message(''); element.disabled=true;
    try {const {result}=await api('/api/calculate',copy(state)); if(current===revision) {showResult(result); tab('order');}}
    catch(e) {if(current===revision) {lastResult=null; calculationError=true; updateDashboard(); message(friendly(e.message)); $('result-panel').innerHTML='<div class="empty">Расчёт заблокирован. Исправьте указанные выше поля. Неизвестные значения не заменяются нулём.</div>';}}
    finally {element.disabled=false;}
    return;
  }
  if(name==='download') {
    const {state:valid}=await api('/api/validate',copy(state));
    const blob=new Blob([JSON.stringify(valid,null,2)],{type:'application/json'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob); link.download='FurnitureCalc-'+(state.order.number || 'draft').replace(/[^\p{L}\p{N}_-]/gu,'_')+'.json';
    link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); return;
  }
  if(name==='open') {$('file').click(); return;}
  if(name==='demo' || name==='new') {
    if(!confirm('Заменить текущий заказ? Для отдельной копии сначала сохраните его в файл.')) return;
    if(name==='demo') state=(await api('/api/demo')).state;
    else state={format:'furniturecalc-order-1',catalog:copy(state.catalog),order:{id:id(),number:'',date:today(),client:'',conditions:'',products:[],expenses:[],expenses_confirmed:false,settings:{reserve_pct:'0',overhead_pct:'0',pricing_mode:'markup',pricing_pct:'0',discount_pct:'0',vat_mode:'none',vat_pct:'0'}}};
    selectedTab='order';
  } else if(name==='refresh') {
    if(!confirm('Заменить сохранённые цены, источники и размеры материалов в этом заказе текущими данными каталога?')) return;
    const current=revision, refreshed=await api('/api/refresh-prices',copy(state));
    if(current!==revision) throw new Error('Заказ изменился во время обновления. Повторите действие.');
    state=refreshed.state;
  } else if(name==='product') state.order.products.push({id:id(),name:'',code:'',quantity:'1',length_mm:'',width_mm:'',height_mm:'',parts:[newPart()],hardware:[],work:[],composition_confirmed:false});
  else if(name==='part') {get(path).push(newPart()); set(path.replace(/\.parts$/,'.composition_confirmed'),false);}
  else if(name==='usage') {get(path).push({id:id(),resource:null,quantity:'',unit:element.dataset.kind==='work'?'hour':'piece'}); set(path.replace(/\.(hardware|work)$/,'.composition_confirmed'),false);}
  else if(name==='expense') {state.order.expenses.push({id:id(),kind:'delivery',resource:null,quantity:'1',unit:'set'}); state.order.expenses_confirmed=false;}
  else if(name==='catalog') state.catalog.push({id:id(),name:'',sku:'',kind:'sheet',unit:'sheet',price:'',source:'Ручной ввод',date:today(),revision:'1',length_mm:'',width_mm:'',thickness_mm:'16'});
  else if(name==='copy') {const keys=path.split('.'),index=Number(keys.pop()),list=get(keys.join('.')),cloned=copy(list[index]); cloned.id=id(); if(cloned.name) cloned.name+=' (копия)'; list.splice(index+1,0,cloned);}
  else if(name==='remove') {if(!confirm('Удалить эту строку?')) return; const keys=path.split('.'),index=Number(keys.pop());get(keys.join('.')).splice(index,1);}
  changed(); render();
}
document.addEventListener('input',event=>{
  const el=event.target,path=el.dataset.bind;
  if(!path || el.tagName==='SELECT' || el.type==='checkbox' || !state) return;
  set(path,el.value); changed();
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(!state) return;
  if(el.dataset.resource) {
    const candidates=state.catalog.filter(x=>x.id===el.value);
    if(el.value && candidates.length!==1) {message('Позиция отсутствует или ID неоднозначен. Выберите единственную позицию каталога.'); render(); return;}
    const snap=el.value?copy(candidates[0]):null; set(el.dataset.resource,snap);
    if(el.dataset.resource.endsWith('.resource') && snap) set(el.dataset.resource.replace(/\.resource$/,'.unit'),snap.unit);
    changed(); render();
  } else if(el.dataset.bind && (el.tagName==='SELECT' || el.type==='checkbox')) {
    set(el.dataset.bind,el.type==='checkbox'?el.checked:el.value);
    if(el.dataset.bind.endsWith('.kind') && el.dataset.bind.startsWith('catalog.')) set(el.dataset.bind.replace(/\.kind$/,'.unit'),{sheet:'sheet',material:'m2',edge:'m',hardware:'piece',work:'hour',expense:'set'}[el.value]);
    changed(); if(el.tagName==='SELECT') render();
  }
});
document.addEventListener('click',event=>{
  const el=event.target.closest('button'); if(!el) return;
  if(el.dataset.tab) {tab(el.dataset.tab); return;}
  if(el.dataset.action) action(el.dataset.action,el.dataset.path,el).catch(e=>message(e.message));
});
$('file').addEventListener('change',async event=>{
  const file=event.target.files[0]; if(!file) return;
  try {
    if(file.size>5*1024*1024) throw new Error('Файл больше 5 МБ.');
    const imported=JSON.parse(await file.text());
    const {state:valid}=await api('/api/validate',imported);
    if(!confirm(`Открыть проект «${valid.order.number || 'без номера'}» (${valid.order.products.length} изделий) вместо текущего?`)) return;
    state=valid; changed(); render(); tab('order');
  } catch(e) {message('Проект не открыт; текущий заказ сохранён.\n'+e.message);}
  finally {event.target.value='';}
});
for(const kind of ['price','spec']) $(kind+'-file').addEventListener('change',async event=>{
  const file=event.target.files[0]; if(!file) return;
  const current=revision;
  try {
    if(file.size>5*1024*1024) throw new Error('Файл больше 5 МБ.');
    message('Читаем файл на вашем устройстве…');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const data=await api('/api/import-'+kind,{filename:file.name,data:btoa(binary),catalog:copy(state.catalog)});
    if(current!==revision) throw new Error('Заказ изменился во время чтения. Загрузите файл ещё раз.');
    importPreview={kind,data,revision:current};
    $('import-title').textContent=file.name;
    const grid=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x ?? 'Не задано')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if(kind==='price') $('import-preview').innerHTML='<p>Будет заменён только каталог. Снимки цен в заказе сохранятся.</p>'+grid(['ID','Название / артикул','Тип','Единица','Цена, руб.','Лист, мм','Источник / дата / версия'],data.catalog.map(x=>[x.id,x.name+' / '+x.sku,kinds[x.kind],units[x.unit],x.price,[x.length_mm,x.width_mm,x.thickness_mm].join(' × '),[x.source,x.date,x.revision].join(' / ')]));
    else {
      const rows=[];
      for(const p of data.state.order.products) {
        rows.push(['Изделие',p.name,p.code,p.quantity,'шт.',[p.length_mm,p.width_mm,p.height_mm].join(' × '),'']);
        for(const part of p.parts) {rows.push(['Деталь',part.name,part.id,part.quantity,'на изделие',[part.length_mm,part.width_mm].join(' × '),part.material?part.material.name+' / '+part.material.price+' руб./'+units[part.material.unit]:'Материал не задан']); for(const [side,resource] of Object.entries(part.edges)) rows.push(['Кромка',sides[side],part.id,'по стороне','', '',resource?resource.name+' / '+resource.price+' руб./м':'Без кромки — требует подтверждения']);}
        for(const key of ['hardware','work']) for(const row of p[key]) rows.push([kinds[key],row.resource?.name,row.id,row.quantity,units[row.unit],'на изделие',row.resource?.price]);
      }
      for(const row of data.state.order.expenses) rows.push(['Расход заказа',row.resource?.name,row.id,row.quantity,units[row.unit],row.kind,row.resource?.price]);
      $('import-preview').innerHTML='<p>Текущий заказ будет заменён черновиком из файла. Сначала сохраните старый в файл, если он нужен. После импорта проверьте состав и кромление, подтвердите их в карточках и задайте проценты: новый черновик начинает с нулевых начислений.</p>'+grid(['Тип','Название','Код / ID','Количество','Единица','Размер / область','Материал / ставка'],rows);
    }
    message('');$('import-dialog').showModal();
  } catch(error) {message('Импорт не применён. Текущие данные сохранены.\n'+friendly(error.message));}
  finally {event.target.value='';}
});
(async()=>{
  try {
    if(window.furnitureBackend) $('hosted-imports').hidden=false;
    const data=await api('/api/state'); state=data.state;
    let cached; try {cached=localStorage.getItem(cacheKey);} catch {}
    if(cached && confirm('В браузере остались изменения, не записанные на диск. Восстановить их?')) {
      state=(await api('/api/validate',JSON.parse(cached))).state;
      changed();
    } else {try {localStorage.removeItem(cacheKey);} catch {} $('save-status').textContent=data.is_demo?'Учебный пример · ещё не сохранён':'Черновик восстановлен';}
    render();
    if(data.warning) message(data.warning);
  } catch(e) {message('Не удалось открыть приложение: '+e.message); $('save-status').textContent='Ошибка загрузки';}
})();
