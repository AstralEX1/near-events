'use client';
import {useState} from 'react';
import Component from './Component.jsx';
// Demo only. Replace handlers with your real application operations.
function wait(signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(new DOMException('Canceled','AbortError'));return;}const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},700);function abort(){clearTimeout(timer);reject(new DOMException('Canceled','AbortError'));}signal?.addEventListener('abort',abort,{once:true});});}

export default function Example(){
 const [message,setMessage]=useState("Local sharing example. Copy link copies the sample URL to your clipboard; no network request is made.");
 return <><Component callbacks={{getUrl:()=> 'https://example.com/article',onShare:async({signal})=>{await wait(signal);setMessage('Local sharing preview. Nothing was sent.');return {label:'Preview complete'};}}} onError={error=>setMessage(error.message)}/><p role="status">{message}</p></>;
}
