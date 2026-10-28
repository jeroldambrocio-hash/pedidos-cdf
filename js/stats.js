// Delivery dates use Manila. History includes archived orders. No customer history is cached across accounts.
let statsDays=30, statsRows=null, statsFor=null, statsVersion=0, statsRequest=0;
function invalidateStats(){statsVersion++;statsFor=null;statsRows=null;statsRequest++;}
async function renderStats(){
 if(!isAdmin())return;
 const box=$("statsBody"),account=S.me.email,key=[account,S.today,statsDays,pricesOn(),statsVersion].join("|"),request=++statsRequest;
 $("statsPeriod").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.days===statsDays)));placePill($("statsPeriod"));
 if(statsFor!==key){
  box.replaceChildren(el("div",{class:"kpis six","aria-busy":"true"},...Array.from({length:6},()=>el("div",{class:"kpi"},el("div",{class:"skel",style:"height:50px"})))));
  try{const data=await historyRows();if(request!==statsRequest||S.me?.email!==account||S.tab!=="stats")return;statsRows=data;statsFor=key;}
  catch(e){if(request!==statsRequest)return;box.replaceChildren(el("div",{class:"empty"},el("b",{},e.message),el("button",{class:"btn",type:"button",onclick:()=>{invalidateStats();renderStats()}},t("retry"))));return;}
 }
 const history=statsRows.filter(o=>o.date<=S.today),from=addDays(S.today,1-statsDays),prevFrom=addDays(from,-statsDays);
 const rows=history.filter(o=>o.date>=from),previous=history.filter(o=>o.date>=prevFrom&&o.date<from),prices=pricesOn();
 const sum=os=>os.reduce((a,o)=>a+(+o.amount||0),0),ticket=os=>{const known=os.filter(o=>o.amount!=null);return known.length?sum(known)/known.length:null};
 const metric=os=>prices?sum(os):os.length,fmt=v=>prices?peso(v):String(v),pct=n=>n==null?"—":Math.round(n*100)+"%";
 const who=o=>intlPhone(o.buyer_phone||o.customer_phone)||norm(o.buyer_name),buyers=new Map();
 for(const o of history){const id=who(o);if(!id)continue;const b=buyers.get(id)||{name:o.buyer_name||t("noName"),n:0,total:0,last:""};b.n++;b.total+=+o.amount||0;b.last=b.last>o.date?b.last:o.date;buyers.set(id,b);}
 const periodBuyers=new Set(rows.map(who).filter(Boolean)),repeat=periodBuyers.size?[...periodBuyers].filter(id=>(buyers.get(id)?.n||0)>1).length/periodBuyers.size:null;
 // An unsuccessful attempt belongs in the denominator, even before eventual delivery.
 const attempted=rows.filter(o=>o.delivery==="Delivered"||o.delivery==="Failed"||o.attempts>0),first=attempted.length?attempted.filter(o=>o.delivery==="Delivered"&&!o.attempts).length/attempted.length:null;
 const delta=(a,b)=>b?Math.round((a-b)/b*100):null;
 const kpi=(glyph,label,value,d,hint)=>el("div",{class:"kpi"},el("span",{class:"ic"},icon(glyph)),el("small",{},label),el("b",{},value),el("span",{class:"delta"},d==null?hint||"":t("statsDelta",{n:(d>0?"+":"")+d,days:statsDays})));
 const card=(title,sub,...kids)=>el("section",{class:"panel chart-card"},el("div",{class:"chart-head"},el("h3",{},title),sub?el("small",{},sub):null),...kids);
 const channels=[...CHANNELS,...(rows.some(o=>!o.channel)?[t("noChannel")]:[])].map(ch=>{const os=rows.filter(o=>(o.channel||t("noChannel"))===ch);return{ch,os,value:metric(os)}}).sort((a,b)=>b.value-a.value);
 const bars=(entries,format=String,logos=false)=>{
  const max=Math.max(1,...entries.map(e=>e.value));
  return entries.length?el("div",{class:"hbars"},entries.map(e=>el("div",{class:"hbar",tabindex:"0",title:e.name+": "+format(e.value),"aria-label":e.name+": "+format(e.value)},el("span",{class:"hbar-label"},logos&&CHANNELS.includes(e.name)?el("span",{class:"chan-logo sm"},chanMark(e.name)):null,e.name),el("span",{class:"hbar-track"},el("span",{class:"hbar-fill",style:`--w:${100*e.value/max}%`})),el("span",{class:"hbar-val"},el("b",{},format(e.value)),e.detail?el("small",{},e.detail):null)))):el("p",{class:"hint"},t("noData"));
 };
 const step=statsDays===90?7:1,buckets=[];
 for(let start=from;start<=S.today;start=addDays(start,step)){const end=addDays(start,step-1),os=rows.filter(o=>o.date>=start&&o.date<=end);buckets.push({start,os,value:metric(os)})}
 const max=Math.max(1,...buckets.map(b=>b.value));
 const chart=el("div",{class:"cols",style:`--n:${buckets.length}`},buckets.map(b=>{
  const title=shortDate(b.start)+" · "+dayCount(b.os.length)+(prices?" · "+peso(b.value):"");
  return el("button",{type:"button",class:"col","aria-label":title,title,onclick:()=>{setTab("orders");selectDay(b.start)}},el("span",{class:"col-fill",style:`--h:${100*b.value/max}%`}))}));
 const daily=card(t(prices?(step===7?"salesPerWeek":"salesPerDay"):(step===7?"ordersPerWeek":"perDay")),t("statsPeriodHint",{days:statsDays}),chart,el("div",{class:"cols-axis"},el("span",{},shortDate(from)),el("span",{},t("today"))),el("table",{class:"sr-only"},el("caption",{},t("perDay")),el("tbody",{},buckets.map(b=>el("tr",{},el("th",{},shortDate(b.start)),el("td",{},fmt(b.value)))))));
 const hours=Array.from({length:24},(_,h)=>({name:pad(h)+":00",value:rows.filter(o=>Math.floor(slotStart(o.slot)/60)===h).length}));
 // Keep 7–20 visible as in the preview; include earlier/later hours when orders use them.
 const shown=hours.filter((h,i)=>(i>=7&&i<=20)||h.value),hourMax=Math.max(1,...hours.map(h=>h.value));
 const hourChart=el("div",{class:"cols hours",style:`--n:${shown.length}`},shown.map(h=>el("button",{type:"button",class:"col",title:h.name+": "+dayCount(h.value),"aria-label":h.name+": "+dayCount(h.value)},el("span",{class:"col-fill",style:`--h:${100*h.value/hourMax}%`}),el("small",{class:"col-x"},h.name))));
 const vendors=new Map();for(const o of rows){const name=memberName(o.vendor_email);vendors.set(name,(vendors.get(name)||0)+1)}
 const best=[...buyers.values()].sort((a,b)=>prices?b.total-a.total:b.n-a.n).slice(0,6);
 const customers=el("table",{class:"top"},el("thead",{},el("tr",{},el("th",{},t("buyerName")),el("th",{},t("kpiOrders")),prices?el("th",{},t("statsTotal")):null,el("th",{},t("statsLast")))),el("tbody",{},best.map(b=>el("tr",{},el("td",{},b.name),el("td",{},String(b.n)),prices?el("td",{},peso(b.total)):null,el("td",{},shortDate(b.last))))));
 const leading=channels[0],total=metric(rows),topHour=hours.reduce((a,b)=>!a||b.value>a.value?b:a,null),ideas=[];
 if(leading?.value&&total)ideas.push(["trend",t("ideaLeading",{channel:leading.ch,n:Math.round(100*leading.value/total)}),t("ideaLeadingHelp")]);
 const weak=[...channels].filter(c=>c.os.length).sort((a,b)=>a.value-b.value)[0];
 if(weak&&channels.filter(c=>c.os.length).length>1)ideas.push(["chart",t("ideaWeak",{channel:weak.ch,n:weak.os.length}),t("ideaWeakHelp")]);
 if(prices){const premium=[...channels].filter(c=>ticket(c.os)!=null).sort((a,b)=>ticket(b.os)-ticket(a.os))[0];if(premium)ideas.push(["star",t("ideaPremium",{channel:premium.ch,sum:peso(ticket(premium.os))}),t("ideaPremiumHelp")])}
 if(first!=null&&first<.95)ideas.push(["alert",t("ideaAttempts",{n:Math.round((1-first)*100)}),t("ideaAttemptsHelp")]);
 if(topHour?.value)ideas.push(["clock",t("ideaHour",{hour:topHour.name}),t("ideaHourHelp")]);
 if(repeat!=null)ideas.push(["user",t("ideaRepeat",{n:Math.round(repeat*100)}),t("ideaRepeatHelp")]);
 const primary=prices?[kpi("trend",t("kpiSales"),peso(sum(rows)),delta(sum(rows),sum(previous))),kpi("orders",t("kpiOrders"),String(rows.length),delta(rows.length,previous.length)),kpi("star",t("statsTicket"),ticket(rows)==null?"—":peso(ticket(rows)),ticket(previous)?delta(ticket(rows)||0,ticket(previous)):null)]:[kpi("orders",t("kpiOrders"),String(rows.length),delta(rows.length,previous.length)),kpi("trend",t("statsAverage"),(rows.length/statsDays).toLocaleString(locale(),{maximumFractionDigits:1}),delta(rows.length,previous.length)),kpi("star",t("statsLeading"),leading?.value?leading.ch:"—",null,leading?.value?dayCount(leading.os.length):t("noData"))];
 const panels=[daily,card(t(prices?"bySales":"byChannel"),null,bars(channels.map(c=>({name:c.ch,value:c.value,detail:prices?dayCount(c.os.length)+" · "+t("statsTicket")+" "+(ticket(c.os)==null?"—":peso(ticket(c.os))):pct(rows.length?c.os.length/rows.length:null)})),fmt,true)),card(t("statsHours"),t("statsHoursHint"),hourChart),card(t("byFlorist"),null,bars([...vendors].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value))),card(t("statsCustomers"),t("statsHistoryHint"),best.length?customers:el("p",{class:"hint"},t("noData"))),card(t("statsIdeas"),t("statsIdeasHint"),el("ul",{class:"ideas"},ideas.map(([glyph,title,detail])=>el("li",{},el("span",{class:"ic"},icon(glyph)),el("div",{},el("b",{},title),el("small",{},detail))))))];
 box.replaceChildren(el("div",{class:"kpis six"},...primary,kpi("check",t("kpiFirstTry"),pct(first),null,t("statsFirstHint")),kpi("user",t("kpiRepeat"),pct(repeat),null,t("statsRepeatHint")),kpi("alert",t("kpiAttempts"),String(rows.reduce((n,o)=>n+(o.attempts||0),0)),null,t("kpiAttemptsHint"))),el("div",{class:"chart-grid"},...panels));
 stagger(box.querySelector(".kpis"));
 if(!prefersReducedMotion())box.querySelectorAll(".hbar-fill,.col-fill").forEach((n,i)=>n.animate([{transform:n.classList.contains("hbar-fill")?"scaleX(0)":"scaleY(0)"},{transform:"none"}],{duration:420,delay:Math.min(i,30)*12,easing:"cubic-bezier(.16,1,.3,1)",fill:"backwards"}));
}
