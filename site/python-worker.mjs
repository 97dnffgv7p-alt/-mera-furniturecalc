import { loadPyodide } from './runtime/pyodide.mjs';

const base = new URL('.', import.meta.url);
async function prepare() {
  self.postMessage({progress:'Загрузка Python для расчёта… Первый запуск может занять до минуты.'});
  const py = await loadPyodide({indexURL:new URL('runtime/',base).href});
  const manifest = await fetch(new URL('python-manifest.json',base)).then(r=>{if(!r.ok) throw new Error('Нет модулей расчёта'); return r.json();});
  for (const path of manifest.files) {
    const response=await fetch(new URL(path,base));
    if(!response.ok) throw new Error('Не удалось загрузить '+path);
    py.FS.mkdirTree('/app/'+path.slice(0,path.lastIndexOf('/')));
    py.FS.writeFile('/app/'+path,new Uint8Array(await response.arrayBuffer()));
  }
  for (const wheel of manifest.wheels) {
    const response=await fetch(new URL('wheels/'+wheel,base));
    if(!response.ok) throw new Error('Не удалось загрузить библиотеку Excel');
    py.unpackArchive(await response.arrayBuffer(),'zip',{extractDir:'/app/python'});
  }
  py.runPython("import sys\nsys.path.insert(0, '/app/python')\nfrom furniturecalc.browser_bridge import dispatch");
  self.postMessage({progress:'Python готов · файлы обрабатываются только на вашем устройстве'});
  return py;
}
const ready=prepare();
// Serial execution prevents shared Python globals from mixing concurrent requests.
let queue=Promise.resolve();
self.onmessage=({data})=>{
  queue=queue.catch(()=>{}).then(async()=>{
    try {
      const py=await ready;
      py.globals.set('_request_json',JSON.stringify({action:data.action,payload:data.payload}));
      const result=JSON.parse(py.runPython('dispatch(_request_json)'));
      py.globals.delete('_request_json');
      self.postMessage({id:data.id,...result});
    } catch(error) {self.postMessage({id:data.id,ok:false,errors:['Не удалось запустить Python: '+error.message]});}
  });
};
