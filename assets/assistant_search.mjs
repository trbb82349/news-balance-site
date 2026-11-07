// 브라우저와 서버가 같은 검색 규칙을 사용한다. AI 모델을 호출하지 않는다.
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g,' ').trim();
const stop = new Set('최근 오늘 어제 뉴스 기사 관련 비슷한 사건 찾아줘 찾아주세요 알려줘 알려주세요 검색 설명 쉽게 해줘 뭐야 무엇인가요 무엇이 이 그 대해 대한 주세요'.split(' '));
const includes=(text,term)=>/^[a-z0-9 ]+$/.test(term) ? new RegExp('(?:^|[^a-z0-9])'+term+'(?:$|[^a-z0-9])').test(text) : text.includes(term);
function words(text) {
  return [...new Set(normalize(text).split(' ').filter(w => w.length > 1 && !stop.has(w)))];
}
function inRange(item, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '')) return false;
  const today = new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const age = (Date.parse(today)-Date.parse(item.date))/86400000;
  return age >= 0 && age < 30;
}
function queryScore(text, tokens) {
  const normalized = normalize(text);
  return tokens.reduce((score, token) => {
    const stem=token.length>2 ? token.replace(/(에서는|에서|으로|은|는|을|를|이|가|의|와|과|도)$/u,'') : token;
    return score + (includes(normalized,token) || (stem.length>1 && includes(normalized,stem)) ? 1 : 0);
  }, 0);
}
function grams(text) {
  const result=new Set();
  for (const word of words(text)) for(let i=0;i<word.length-1;i++) result.add(word.slice(i,i+2));
  return result;
}
function unique(items) {
  const seen=new Set();
  return items.filter(n=>{const key=normalize(n.title);if(seen.has(key)) return false;seen.add(key);return true;}).slice(0,5);
}
export function search(index, query, {mode='auto',currentId=null,now=new Date()}={}) {
  const available=(index.news || []).filter(n=>inRange(n,now)).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));
  const normalized=normalize(query), tokens=words(query);
  let terms=[],news=[];
  if(mode==='related') {
    const current=available.find(n=>n.id===currentId);
    if(!current) return {terms,news,message:'먼저 최근 30일 뉴스 한 건을 선택해 주세요.'};
    const base=grams(current.title+' '+current.summary), titleGrams=grams(current.title);
    news=available.filter(n=>n.id!==current.id && normalize(n.title)!==normalize(current.title)).map(n=>{
      const other=grams(n.title+' '+n.summary), shared=[...base].filter(g=>other.has(g));
      const otherTitle=grams(n.title), titleShared=[...titleGrams].filter(g=>otherTitle.has(g)).length;
      const score=shared.length/Math.sqrt(Math.max(1,base.size*other.size));
      return {...n,score,reason: titleShared>=3 ? '제목과 내용에 공통 표현이 있는 관련 뉴스 후보' : '내용에 공통 표현이 있는 관련 주제 후보'};
    }).filter(n=>n.score>=0.18).sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date));
  } else {
    if(mode!=='news' && normalized) terms=(index.terms || []).map(t=>{
      const names=[t.term,...(t.aliases||[])].map(normalize);
      const score=names.some(n=>n===normalized)?100:names.some(n=>n.length>=2 && includes(normalized,n))?60:queryScore(t.term+' '+(t.aliases||[]).join(' '),tokens)*10;
      return {...t,score};
    }).filter(t=>t.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
    if(mode!=='terms') {
      const expanded=[...new Set([...tokens,...terms.map(t=>normalize(t.term))])];
      news=available.map(n=>({...n,score:queryScore(n.title+' '+(n.keywords||[]).join(' '),expanded)*4+queryScore(n.summary+' '+n.category,expanded)}))
        .filter(n=>n.score>0 || (!expanded.length && /최근|오늘|뉴스/.test(query))).sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date));
    }
  }
  news=unique(news);
  return {terms,news,message: terms.length||news.length ? (mode==='related'?'같은 사건이라는 뜻은 아니에요. 날짜와 내용을 함께 비교해 주세요.':'뉴스밸런스에 저장된 자료에서 찾았어요.') : '저장된 자료에서 찾지 못했어요. 짧은 용어나 핵심 단어로 다시 찾아주세요.'};
}
export {inRange};
