'use strict';
(() => {
  const key='mera-furniturecalc-order-1';
  let worker, sequence=0, demo;
  const pending=new Map();
  function requestPython(action,payload) {
    if(!worker) {
      worker=new Worker('/python-worker.mjs',{type:'module'});
      worker.onmessage=({data})=>{
        if(data.progress) {const label=document.getElementById('save-status'); if(label) label.textContent=data.progress; return;}
        const task=pending.get(data.id); if(!task) return;
        clearTimeout(task.timeout); pending.delete(data.id);
        data.ok?task.resolve(data.data):task.reject(new Error(data.errors.join('\n')));
      };
      worker.onerror=()=>{for(const task of pending.values()){clearTimeout(task.timeout);task.reject(new Error('Python не загрузился. Проверьте соединение и обновите страницу.'));}pending.clear();worker.terminate();worker=null;};
    }
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Расчёт не ответил за 120 секунд. Обновите страницу или уменьшите файл.'));},120000);
      pending.set(id,{resolve,reject,timeout});worker.postMessage({id,action,payload});
    });
  }
  async function demoState() {
    if(!demo) demo=await fetch('/order_demo.json').then(r=>{if(!r.ok) throw new Error('Учебный пример недоступен');return r.json();});
    return JSON.parse(JSON.stringify(demo));
  }
  window.furnitureBackend={async request(action,payload) {
    if(action==='/api/demo') return {state:await demoState()};
    if(action==='/api/state') {
      let saved;
      try {saved=localStorage.getItem(key);} catch {return {state:await demoState(),is_demo:true,warning:'Браузер запретил локальное хранилище. Сохраняйте проект в файл; автосохранение недоступно.'};}
      if(saved) {try {return {...await requestPython('/api/validate',JSON.parse(saved)),is_demo:false};}catch(error){return {state:await demoState(),is_demo:true,warning:'Сохранённый проект не открыт: '+error.message+'. Он остаётся в хранилище до следующего сохранения. Откройте исправную копию из файла.'};}}
      return {state:await demoState(),is_demo:true};
    }
    const result=await requestPython(action,payload);
    if(action==='/api/save') {localStorage.setItem(key,JSON.stringify(result.state));return {saved:true};}
    return result;
  }};
})();
