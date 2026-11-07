import {search,inRange} from './assistant_search.mjs';
const config=JSON.parse(document.getElementById('pf-assistant-config').textContent);
const el=id=>document.getElementById(id), panel=el('pf-assistant'), log=el('pc-log');
const base=new URL(config.base,location.href), currentId=location.pathname.match(/\/news\/([^/]+)\.html$/)?.[1]||null;
let indexPromise=null,lastRequest=null,searching=false,aiBusy=false,widget=null,proof='',generation=0,captchaPromise=null;
let aiController=null,aiSequence=0;
const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const status=text=>{el('pc-status').textContent=text;};
function appendBubble(text,user=false) {
  const bubble=node('div','',user?'pc-bubble user':'pc-bubble');bubble.append(node('p',text));log.append(bubble);
  while(log.children.length>16) log.firstElementChild.remove();
  log.scrollTop=log.scrollHeight;return bubble;
}
function safeLink(url) {return /^news\/[a-z0-9-]+\.html$/.test(url||'') ? new URL(url,base).href : null;}
function link(parent,title,url) {const href=safeLink(url);if(!href) return;const a=node('a',title);a.href=href;parent.append(a);}
async function loadIndex() {
  if(!indexPromise) indexPromise=fetch(new URL('assets/assistant-index.json',base),{signal:AbortSignal.timeout(12000),cache:'no-cache'})
    .then(async r=>{if(!r.ok)throw new Error();const data=await r.json();if(data.version!==1)throw new Error();return data;})
    .catch(()=>{indexPromise=null;throw new Error('검색 자료를 불러오지 못했어요. 연결을 확인하고 다시 찾아주세요.');});
  return indexPromise;
}
function resetChallenge() {
  generation++;proof='';el('pc-ai-send').disabled=true;
  if(widget!==null && window.turnstile) window.turnstile.remove(widget);
  widget=null;el('pc-ai-panel').hidden=true;
}
function button(text,fn) {const b=node('button',text);b.type='button';b.addEventListener('click',fn);return b;}
function stopAI() {aiSequence++;aiController?.abort();aiController=null;aiBusy=false;el('pc-ai-cancel').disabled=false;}
async function find(query,mode=el('pc-mode').value,selectedId=null) {
  if(searching) return;
  query=query.trim();if(!query)return;
  stopAI();searching=true;el('pc-search').disabled=true;resetChallenge();status('자료를 찾고 있어요…');
  try {
    const index=await loadIndex(),result=search(index,query,{mode,currentId:selectedId});
    appendBubble(query,true);const bubble=appendBubble(result.message);
    for(const term of result.terms) {
      const card=node('div','','pc-card');card.append(node('strong',term.term),node('p',term.definition));
      if(term.detail)card.append(node('p',term.detail));
      if(term.asOf)card.append(node('small','설명 기준: '+term.asOf));
      for(const newsId of (term.newsIds||[]).slice().reverse().slice(0,2)) {const n=index.news.find(n=>n.id===newsId && inRange(n,new Date()));if(n) {const row=node('div','');link(row,'관련 뉴스: '+n.title,n.url);card.append(row);}}
      bubble.append(card);
    }
    for(const item of result.news) {
      const card=node('div','','pc-card');link(card,item.title,item.url);card.append(node('small',item.date+' · '+item.category),node('p',item.summary.slice(0,150)+(item.summary.length>150?'…':'')));
      if(item.reason)card.append(node('small',item.reason));
      const actions=node('div','','pc-actions');actions.append(button('비슷한 뉴스',()=>find(item.title+'와 관련된 뉴스','related',item.id)),button('이 뉴스 쉽게 설명',()=>{
        if(aiBusy || searching)return;lastRequest={query:'이 뉴스의 내용을 쉽게 설명해줘',mode:'news',currentId:item.id};startAI();
      }));card.append(actions);bubble.append(card);
    }
    lastRequest={query,mode,currentId:selectedId};el('pc-ai').hidden=!(result.terms.length||result.news.length)||!config.api;
    status('뉴스 자료의 최신 게시일: '+index.latestDate);el('pc-query').value='';log.scrollTop=log.scrollHeight;
  } catch(error) {status(error.message);}
  finally {searching=false;el('pc-search').disabled=false;}
}
async function captcha() {
  if(window.turnstile)return;
  if(!captchaPromise)captchaPromise=new Promise((resolve,reject)=>{
    let script=document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
    const added=!script;
    if(!script){script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;}
    const timer=setTimeout(()=>{if(added)script.remove();reject(new Error('사람 확인 연결이 지연됐어요. 다시 시도해 주세요.'));},12000);
    script.addEventListener('load',()=>{clearTimeout(timer);window.turnstile?resolve():reject(new Error('사람 확인을 불러오지 못했어요.'));},{once:true});
    script.addEventListener('error',()=>{clearTimeout(timer);if(added)script.remove();reject(new Error('사람 확인 연결을 허용하고 다시 시도해 주세요.'));},{once:true});
    if(added)document.head.append(script);
  }).catch(error=>{captchaPromise=null;throw error;});
  return captchaPromise;
}
async function startAI() {
  if(aiBusy||searching||!lastRequest)return;
  resetChallenge();el('pc-ai-panel').hidden=false;const sequence=generation;
  status('사람 확인 후 설명 받기를 눌러주세요.');
  try {
    await captcha();if(sequence!==generation)return;
    widget=window.turnstile.render(el('pc-challenge'),{sitekey:config.sitekey,action:'assistant',size:'flexible',
      callback:value=>{proof=value;el('pc-ai-send').disabled=false;},
      'expired-callback':()=>{proof='';el('pc-ai-send').disabled=true;},
      'error-callback':()=>{proof='';el('pc-ai-send').disabled=true;status('사람 확인에 실패했어요. 취소 후 다시 시도해 주세요.');}});
  } catch(error) {status(error.message);}
}
el('pc-ai-send').addEventListener('click',async()=>{
  if(aiBusy||!proof||!lastRequest)return;
  const request={...lastRequest,challenge:proof},sequence=++aiSequence,controller=new AbortController();
  aiController=controller;const timer=setTimeout(()=>controller.abort(),60000);
  aiBusy=true;el('pc-ai-send').disabled=true;status('푸딩이가 자료를 읽고 있어요… 새 검색은 바로 이용할 수 있어요.');
  try {
    const response=await fetch(config.api+'/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
    const data=await response.json();if(sequence!==aiSequence)return;
    if(!response.ok)throw new Error(data.error||'설명을 만들지 못했어요. 기본 검색을 이용해 주세요.');
    const bubble=appendBubble('🍮 AI가 쉽게 풀어봤어요\n'+data.answer);
    data.sources.forEach((source,i)=>{const row=node('p','');if(source.url)link(row,`[${i+1}] ${source.title}`,source.url);else row.textContent=`[${i+1}] 용어집 · ${source.title}`;bubble.append(row);});
    bubble.append(node('small','AI 설명은 틀릴 수 있어요. 근거 자료와 함께 확인해 주세요.'));status('설명을 마쳤어요.');resetChallenge();log.scrollTop=log.scrollHeight;
  } catch(error) {
    if(sequence!==aiSequence)return;
    status(controller.signal.aborted?'설명이 지연되고 있어요. 기본 검색은 이용할 수 있어요.':error.message);
    proof='';if(widget!==null && window.turnstile)window.turnstile.reset(widget);
  } finally {clearTimeout(timer);if(sequence===aiSequence){aiBusy=false;aiController=null;el('pc-ai-cancel').disabled=false;}}
});
el('pc-ai').addEventListener('click',startAI);
el('pc-ai-cancel').addEventListener('click',()=>{stopAI();resetChallenge();status('기본 검색은 계속 이용할 수 있어요.');});
el('pc-form').addEventListener('submit',event=>{event.preventDefault();find(el('pc-query').value);});
document.querySelectorAll('[data-pc-example]').forEach(b=>b.addEventListener('click',()=>find(b.dataset.pcExample,'auto')));
el('pc-current').hidden=!currentId;
el('pc-current').addEventListener('click',()=>find('지금 읽는 뉴스와 관련된 소식','related',currentId));
el('pc-clear').addEventListener('click',()=>{if(searching)return;stopAI();resetChallenge();log.replaceChildren();lastRequest=null;el('pc-ai').hidden=true;appendBubble('새로운 질문을 기다릴게요 🍮');status('');});
document.querySelector('[data-pf-open="pf-assistant"]').addEventListener('click',()=>{loadIndex().catch(error=>status(error.message));});
panel.addEventListener('close',()=>{if(!aiBusy)resetChallenge();});
