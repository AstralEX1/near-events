'use client';
import {useEffect,useRef,useState} from 'react';
import Component from './Component.jsx';
// Demo only. Replace handlers with your real application operations.
function wait(signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(new DOMException('Canceled','AbortError'));return;}const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},700);function abort(){clearTimeout(timer);reject(new DOMException('Canceled','AbortError'));}signal?.addEventListener('abort',abort,{once:true});});}
// Local equivalent of the source preview adapter. Remove for application integration.
function localFeedbackOperation(root,signal,onProgress){
 const view=root.ownerDocument.defaultView,kind=root.dataset.feedback,fail=Boolean(root.querySelector('[data-demo-error]')?.checked);
 const duration=kind==='linear'||kind==='circular'?3200:kind==='loading'?2600:kind==='skeleton'?1250:850;
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new view.DOMException('Canceled','AbortError'));return;}
  const started=view.performance.now();
  const interval=view.setInterval(()=>{if(!signal.aborted&&(kind==='linear'||kind==='circular'))onProgress?.(Math.min(98,(view.performance.now()-started)/duration*100));},100);
  const timer=view.setTimeout(()=>{cleanup();fail?reject(new Error('Simulated preview failure')):resolve();},duration);
  function cleanup(){view.clearInterval(interval);view.clearTimeout(timer);signal.removeEventListener('abort',abort);}
  function abort(){cleanup();reject(new view.DOMException('Canceled','AbortError'));}
  signal.addEventListener('abort',abort,{once:true});
 });
}
function bindLocalFeedbackControls(root,controller){
 const life=new root.ownerDocument.defaultView.AbortController();let added=0;
 root.addEventListener('feedbackreset',()=>{added=0;},{signal:life.signal});
 // Reset replaces descendants, so delegate on the stable source root.
 root.addEventListener('click',event=>{
  const button=event.target.closest('button[data-demo]');if(!button||!root.contains(button)||button.disabled)return;
  const action=button.dataset.demo;
  if(action==='show')controller.show({tone:root.dataset.tone||'success'});
  else if(action==='tone'){
   for(const option of root.querySelectorAll('[data-demo="tone"]'))option.setAttribute('aria-pressed',String(option===button));
   controller.show({tone:button.dataset.tone});
  }else if(action==='remove')controller.show();
  else if(action==='add'){added++;controller.push({title:'Project update '+added,detail:'A new activity in your workspace.'});}
  else if(action==='clear')controller.clear();
  else if(action==='reset'||action==='offline')controller.reset();
  else if(action==='cancel')controller.cancel();
  else if(action==='start'||action==='load')void controller.run(action);
  else if(action==='unknown'){const unknown=root.querySelector('[data-progress]').dataset.mode!=='unknown';controller.setMode(unknown?'unknown':'determinate');if(controller.state!=='pending')void controller.run('start');}
 },{signal:life.signal});
 return {root,destroy(){life.abort();}};
}

export default function Example(){
 const [message,setMessage]=useState("Local demonstration. No server data is changed.");
 const host=useRef(null),component=useRef(null),binding=useRef(null);
 useEffect(()=>()=>{binding.current?.destroy();binding.current=null;},[]);
 function ready(controller){
  binding.current?.destroy();
  const root=host.current.querySelector('[data-sl-react]>div').shadowRoot.querySelector('.fb-demo');
  binding.current=bindLocalFeedbackControls(root,controller);
 }
 return <div ref={host}><Component ref={component} callbacks={{onAction:async(action,{signal,onProgress})=>{await localFeedbackOperation(binding.current?.root,signal,onProgress);setMessage('Local action preview completed. No server operation was performed.');}}} onReady={ready} onError={error=>setMessage(error.message)}/><button type="button" onClick={()=>component.current?.reset()}>Reset local example</button><p role="status">{message}</p></div>;
}
