/* Approved visual world, applied over current workflows at f5ff388. */
const statusLabel=s=>t('states')[STEPS.indexOf(s)];
const icon = name => {
  const paths = {
 web:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
 orders:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6m-6 4h6"/>',
 team:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4c2 1 3 2 3 5v2"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
 flower:'<path d="M12 21v-9m0 5c-5 0-7-2-7-5 5 0 7 2 7 5Zm0-3c4 0 6-2 6-5-4 0-6 2-6 5Z"/><path d="M12 12C4 12 4 4 8 5c0-5 8-5 8 0 4-1 4 7-4 7Z"/>',
 truck:'<path d="M2 5h12v13H2V5Zm12 4h4l4 5v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
 user:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
 box:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10v10M3 7l9 5 9-5"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
 alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
 note:'<path d="M5 3h14v18H5V3Zm3 5h8m-8 4h8m-8 4h5"/>',
 message:'<path d="M21 11a9 9 0 0 1-9 9H4l-3 3 2-8a9 9 0 1 1 18-4Z"/><path d="M7 11h1m4 0h1m4 0h1"/>',
 search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 6 6"/>',
 list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',map:'<path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15"/>',phone:'<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'};
  const span = el('span', {class:'icon', 'aria-hidden':'true'});
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.arrow)+'</svg>';
  return span;
};

const CHANNEL_MARKS = {"Shopify":"<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><path d=\"M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z\"/></svg>","Instagram":"<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><path d=\"M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077\"/></svg>","TikTok":"<svg viewBox=\"0 0 24 24\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><path d=\"M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z\"/></svg>"};
function chanChip(c) {
  if(!c)return null;
  const known={Shopify:'shopify',Instagram:'instagram',TikTok:'tiktok'};
  const logo=known[c]?el('span',{class:'channel-logo channel-'+known[c],'aria-hidden':'true'}):icon('web');
  if(CHANNEL_MARKS[c])logo.innerHTML=CHANNEL_MARKS[c];
  return el('span',{class:'chan'},logo,c);
}

const setOrderStep=(o,index)=>advance(o,index);
function stepper(o,editable){
  const current=stepOf(o),indices=[0,1,2,current===4?4:3];
  const progress=el('div',{class:'steps order-progress state-'+STEPS[current].k,role:'group','aria-label':t('status')});
  indices.forEach(index=>{
    const attrs={class:(editable?'step':'progress-node')+' s-'+STEPS[index].k+(current===index?' on':index<current?' past':''),'aria-label':statusLabel(STEPS[index])};
    if(editable){attrs.type='button';attrs.disabled=S.statusPending.has(o.id);attrs['aria-pressed']=String(current===index);attrs.onclick=()=>setOrderStep(o,index);}
    else if(current===index)attrs['aria-current']='step';
    progress.append(el(editable?'button':'span',attrs,el('span',{class:'progress-dot','aria-hidden':'true'}),el('span',{},statusLabel(STEPS[index]))));
  });return progress;
}
function statusSelect(o){
  const current=stepOf(o),select=el('select',{class:'status-select s-'+STEPS[current].k,'aria-label':t('status')+' · '+t('order',{num:o.num}),disabled:S.statusPending.has(o.id),onchange:e=>setOrderStep(o,Number(e.target.value))},STEPS.map((s,index)=>el('option',{value:index,selected:index===current},statusLabel(s))));
  return el('div',{class:'order-status s-'+STEPS[current].k},icon(['clock','box','truck','check','alert'][current]),select);
}

function renderDay() {
  const query=S.query.toLocaleLowerCase();
  const matches=o=>!query||[o.num,o.customer_name,o.customer_phone,o.buyer_name,o.buyer_phone,o.address].some(v=>String(v||'').toLocaleLowerCase().includes(query))|| (query.replace(/\D/g,'').length>=3 && String(o.customer_phone||'').replace(/\D/g,'').includes(query.replace(/\D/g,'')));
  const all=S.orders.filter(o=>(query||o.date===S.sel)&&matches(o)).sort((a,b)=>a.date.localeCompare(b.date)||slotMinute(a.slot)-slotMinute(b.slot)||a.num.localeCompare(b.num,undefined,{numeric:true}));
  $('clearSearch').hidden=!query;
  $('dLabel').textContent=query?t('searchResults'):(!isStaff()?t('routeTitle'):cap(fromIso(S.sel).toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'long'})));
  $('dSub').textContent=(all.length===1?t('oneOrder'):t('nOrders',{n:all.length}))+' · '+t('manila');
  // "Nobody home" moves the order to its new date; keep it visible on the day it failed
  const missedHere=isStaff()&&!query?S.orders.filter(o=>o.missed_on===S.sel&&o.date!==S.sel):[];
  const summary=$('summary'); summary.replaceChildren();
  const stat=(label,n,kind,glyph,sub)=>el('div',{class:'summary-card metric-'+kind},el('div',{class:'summary-icon'},icon(glyph)),el('div',{class:'summary-copy'},el('b',{},String(n)),el('span',{},t(label)),el('small',{},t(sub))));
  summary.append(stat('summaryTotal',all.length,'total','orders','statToday'),stat('summaryPending',all.filter(o=>stepOf(o)!==3).length,'pending','clock','statPending'));
  if(isStaff())summary.append(stat('summaryPrep',all.filter(o=>stepOf(o)===0).length,'prep','flower','statPrep'),stat('summaryFailed',all.filter(o=>stepOf(o)===4).length+missedHere.length,'failed','truck','statFailed'),stat('summaryUnassigned',all.filter(o=>!o.vendor_email).length,'unassigned','user','statUnassigned'));
  else if(all.some(o=>stepOf(o)===4))summary.append(stat('summaryFailed',all.filter(o=>stepOf(o)===4).length,'failed','truck','statFailed'));
  const match=o=>S.filter==null?true:S.filter==='pending'?stepOf(o)!==3:S.filter==='unassigned'?!o.vendor_email:stepOf(o)===S.filter;
  const filterSelect=$('statusFilter');
  filterSelect.replaceChildren(el('option',{value:'all'},t('allStatuses')),el('option',{value:'pending'},t('pending')),...STEPS.map((s,i)=>el('option',{value:String(i)},statusLabel(s))),...(isStaff()?[el('option',{value:'unassigned'},t('unassigned'))]:[]));
  filterSelect.value=S.filter==null?'all':String(S.filter);
  const tally=$('tally');tally.replaceChildren();
  const chip=(key,label,n,cls='',glyph='orders')=>tally.append(el('button',{class:'chip '+cls+(S.filter===key?' on':''),type:'button','aria-pressed':String(S.filter===key),onclick:()=>{S.filter=key;renderDay();}},icon(glyph),el('span',{},label),el('b',{},String(n))));
  chip(null,t('allOrders'),all.length);
  chip('pending',t('pending'),all.filter(o=>stepOf(o)!==3).length,'filter-pending','clock');
  STEPS.forEach((s,i)=>chip(i,statusLabel(s),all.filter(o=>stepOf(o)===i).length,'s-'+s.k,['box','check','truck','check','alert'][i]));
  if(isStaff())chip('unassigned',t('unassigned'),all.filter(o=>!o.vendor_email).length,'','user');
  const list=all.filter(match),box=$('list'); box.replaceChildren();
  if(missedHere.length)box.append(el('div',{class:'missed-banner',role:'status'},icon('alert'),el('div',{},
    el('b',{},t('missedBanner',{n:missedHere.length})),
    ...missedHere.map(o=>el('button',{class:'missed-row',type:'button',onclick:()=>{S.sel=o.date;S.month=fromIso(o.date);S.month.setDate(1);renderOrders();openFresh(o);}},
      '#'+o.num+' · '+(o.customer_name||t('noName'))+' → '+shortDate(o.date)+' · '+o.slot,
      o.missed_at?el('small',{},' ('+new Date(o.missed_at).toLocaleTimeString(locale(),{timeZone:TZ,hour:'2-digit',minute:'2-digit'})+')'):null)))));
  if(S.loadError&&!S.loaded){box.append(el('div',{class:'empty'},el('b',{},t('loadFail')),el('button',{class:'btn',onclick:loadOrders},t('retry'))));return;}
  if(!all.length){box.append(el('div',{class:'empty'},el('b',{},t(query?'emptySearch':'noOrdersDay')),t(isStaff()?'emptyAdmin':'emptyVendor')));return;}
  if(!list.length){box.append(el('div',{class:'empty'},el('b',{},t('noneFiltered')),el('button',{class:'btn',onclick:()=>{S.filter=null;renderDay();}},t('showAll'))));return;}
  for(const o of list){
    const current=stepOf(o),state=STEPS[current].k;
    const th=el('div',{class:'thumb'},(o.bouquet_path||o.photo_path)?'':el('img',{src:'/img/emblem.png',alt:'',class:'placeholder-emblem'}));
    if(o.bouquet_path||o.photo_path)photoUrl(o.bouquet_path||o.photo_path,o.bouquet_path?ENTREGAS:bucket).then(u=>{if(u)th.replaceChildren(el('img',{src:u,alt:'',loading:'lazy'}));});
    const details=el('button',{class:'order-open',type:'button',onclick:()=>openFresh(o),'aria-label':t('order',{num:o.num})+' · '+(o.customer_name||t('noName'))},th,el('div',{class:'o-main'},el('div',{class:'o-top'},el('span',{class:'num'},'#'+o.num),chanChip(o.channel)),el('b',{class:'o-name'},o.customer_name||t('noName')),el('div',{class:'o-sub'},isStaff()?memberName(o.vendor_email):o.slot),
      o.attempts>0&&current!==3?el('span',{class:'tag fail'},t('retryTag',{n:o.attempts+1,date:o.missed_on?shortDate(o.missed_on):''})):null));
    const info=el('div',{class:'order-info'});
    const phone=intlPhone(o.customer_phone||'');
    if(/^\d{7,15}$/.test(phone))info.append(el('a',{href:'tel:+'+phone},icon('phone'),'+'+phone));
    info.append(o.address?el('a',{class:'order-location',href:mapsUrl(o.address),target:'_blank',rel:'noopener'},icon('map'),el('span',{},o.address)):el('span',{class:'meta'},t('noAddress')));
    if(o.card_message||o.notes)info.append(el('div',{class:'order-note'},icon('note'),el('span',{},o.card_message||o.notes)));
    const card=el('article',{class:'order state-'+state},details,info,isStaff()?statusSelect(o):el('span',{class:'status-badge s-'+state},statusLabel(STEPS[current])));
    card.append(stepper(o,isStaff()));
    const actions=el('div',{class:'order-actions'});
    if(isStaff())actions.append(el('button',{class:'iconbtn notify-shortcut',type:'button','aria-label':t('notify'),onclick:async()=>{await openFresh(o);document.querySelector('.sheet #f-link')?.scrollIntoView({block:'center',behavior:'instant'});}},icon('message')));
    else{if(o.address)actions.append(el('a',{class:'btn route-map',href:mapsUrl(o.address),target:'_blank',rel:'noopener'},icon('map'),t('map')));if(/^\d{7,15}$/.test(phone))actions.append(el('a',{class:'btn route-phone',href:'tel:+'+phone},icon('phone'),t('call')),el('a',{class:'btn route-whatsapp',href:'https://wa.me/'+phone,target:'_blank',rel:'noopener'},'WhatsApp'));}
    actions.append(el('button',{class:'btn detail-button',type:'button',onclick:()=>openFresh(o)},t('details'),icon('arrow')));card.append(actions);
    const times=o.slot.split(/\s*-\s*/);
    const time=el('div',{class:'route-time'},query?el('small',{},o.date):null,el('b',{},times[0]||o.slot),el('span',{},times[1]||''));
    box.append(el('section',{class:'timeline-entry state-'+state},time,card));
  }
}

function slotMinute(slot){const m=String(slot).match(/(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):1440;}

renderBoard=()=>{S.query=$('q').value.trim();renderDay();};
renderSearch=()=>renderBoard();
$('q').addEventListener('input',()=>{S.filter=null;renderOrders();});
$('clearSearch').onclick=()=>{$('q').value='';S.query='';S.filter=null;renderBoard();$('q').focus();};
$('statusFilter').onchange=e=>{const v=e.target.value;S.filter=v==='all'?null:/^\d$/.test(v)?Number(v):v;renderBoard();};
$('calendarToggle').onclick=()=>{const b=$('calendarToggle'),open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));$('calendarBody').classList.toggle('expanded',open);};
function setDensity(v){document.body.dataset.density=v;$('timelineView').setAttribute('aria-pressed',String(v==='timeline'));$('compactView').setAttribute('aria-pressed',String(v==='compact'));savePref('cdf-density',v);}
$('timelineView').onclick=()=>setDensity('timeline');$('compactView').onclick=()=>setDensity('compact');setDensity(pref('cdf-density')==='compact'?'compact':'timeline');
const originalSub=renderSub;renderSub=()=>{originalSub();$('userAvatar').textContent=S.me?.name?.trim().charAt(0).toUpperCase()||'';for(const [id,g]of[['tabOrders','orders'],['tabTeam','team']])if(!$(id).querySelector('svg'))$(id).prepend(icon(g));};
const originalOrders=renderOrders;renderOrders=()=>{originalOrders();$('workspaceTools').hidden=!isStaff();$('summary').hidden=!isStaff();$('viewControls').hidden=!isStaff();};

// Accessible dialog shell around the unchanged current edit/ready/deliver/reschedule forms.
let dialogReturnFocus=null;
const baseCloseSheet=closeSheet;
closeSheet=()=>{baseCloseSheet();document.body.style.overflow='';if(dialogReturnFocus?.isConnected)dialogReturnFocus.focus();};
function enhanceDialog(){
 const sheet=document.querySelector('.sheet');if(!sheet)return;
 document.body.style.overflow='hidden';sheet.tabIndex=-1;
 const title=sheet.querySelector('h2');if(title){title.id='cdfDialogTitle';sheet.setAttribute('aria-labelledby',title.id);}
 const close=sheet.querySelector('.sheet-head .iconbtn');if(close)close.replaceChildren(icon('close'));
 sheet.querySelectorAll('.field').forEach((field,i)=>{const caption=field.querySelector(':scope > span'),control=field.querySelector('input:not([hidden]),select,textarea');if(caption&&control&&!control.closest('label')&&!control.hasAttribute('aria-label')){caption.id='cdfFieldLabel'+i;control.setAttribute('aria-labelledby',caption.id);}});
 if(onKey)document.removeEventListener('keydown',onKey);
 onKey=e=>{if(e.key==='Escape'){e.preventDefault();closeSheet();return;}if(e.key!=='Tab')return;const items=[...sheet.querySelectorAll('button:not(:disabled),a[href],input:not([hidden]),select,textarea')].filter(n=>n.getClientRects().length);const first=items[0],last=items[items.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===sheet)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===sheet)){e.preventDefault();first?.focus();}};
 document.addEventListener('keydown',onKey);queueMicrotask(()=>sheet.focus());
}
const baseOpenSheet=openSheet;openSheet=o=>{const source=document.activeElement;baseOpenSheet(o);dialogReturnFocus=source;enhanceDialog();};
const baseMiniSheet=miniSheet;miniSheet=(...args)=>{const source=document.activeElement;baseMiniSheet(...args);dialogReturnFocus=source;enhanceDialog();};
const baseWorkCard=workCard;
workCard=(...args)=>{const card=baseWorkCard(...args);for(const button of card.querySelectorAll('.btn.big')){const text=button.textContent.replace(/^✓\s*/,''),glyph=text===t('actOut')?'truck':text===t('actMissed')?'alert':'check';button.replaceChildren(icon(glyph),document.createTextNode(text));}for(const note of card.querySelectorAll('.w-note')){if(note.textContent.startsWith('💌 ')){const text=note.textContent.slice(3);note.replaceChildren(icon('note'),document.createTextNode(text));}}return card;};
