import { readFileSync, writeFileSync } from "node:fs";

const file = "www/index.html";
let html = readFileSync(file, "utf8");

function fail(label) {
  throw new Error(`Could not apply Allotted index fix: ${label}`);
}

function replaceOnce(from, to, label) {
  if (html.includes(from)) {
    html = html.replace(from, to);
    return;
  }
  if (html.includes(to.slice(0, Math.min(80, to.length)))) return;
  fail(label);
}

function replaceFunction(name, replacement) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) {
    if (html.includes(replacement.slice(0, Math.min(80, replacement.length)))) return;
    fail(`function ${name}`);
  }
  const open = html.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        html = html.slice(0, start) + replacement + html.slice(i + 1);
        return;
      }
    }
  }
  fail(`function ${name} body`);
}

function insertAfter(needle, addition, label) {
  if (html.includes(addition.trim().slice(0, 80))) return;
  if (!html.includes(needle)) fail(label);
  html = html.replace(needle, needle + addition);
}

replaceOnce(
  'let tab="dashboard";\n',
  'let tab="dashboard";\nlet storageBroken=false;\nlet storageWarning="";\n',
  "storage flags"
);

replaceFunction("load", `function load(){
  try{
    const raw=localStorage.getItem(KEY);
    if(raw)adoptState(JSON.parse(raw));
  }catch(e){
    storageBroken=true;
    storageWarning="Allotted could not read saved data. Export or restore from a backup before making changes.";
  }
  applyTheme();
  migrate();
}`);

replaceFunction("save", `function save(){
  try{localStorage.setItem(KEY,JSON.stringify(S));storageBroken=false;return true;}
  catch(e){storageBroken=true;storageWarning="Allotted could not save on this device. Copy a backup now so you do not lose changes.";return false;}
}`);

replaceFunction("commit", `function commit(){
  const ok=save();
  render();
  if(!ok)setTimeout(()=>toast(storageWarning||"Allotted could not save your changes","var(--red)"),50);
}`);

insertAfter(
  'function shiftMonth(k,n){const[y,m]=k.split("-").map(Number);const d=new Date(y,m-1+n,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}\n',
  `
function selectMonth(k,carryForward){
  const prev=mk;
  mk=k;
  if(carryForward&&!S.months[mk]){
    const src=latestBefore(mk);
    if(src){
      S.months[mk]=cloneForward(src);
      save();
      toast("Copied "+monthShort(src)+"'s plan into "+monthName(mk)+". Spending reset to $0.","var(--teal)",()=>{delete S.months[mk];mk=prev;commit();});
    }
  }
  render();
}
function nonNeg(v){v=parseFloat(v);return isNaN(v)?0:Math.max(0,v);}
`,
  "month selection helpers"
);

replaceFunction("billOccurrencesBetween", `function billOccurrencesBetween(from,to){
  const out=[];
  let y=from.getFullYear(),mo=from.getMonth();
  const endY=to.getFullYear(),endMo=to.getMonth();
  let guard=0;
  while((y<endY||(y===endY&&mo<=endMo))&&guard<24){
    const key=y+"-"+String(mo+1).padStart(2,"0");
    const realMonth=!!S.months[key];
    const mm=S.months[key]||(latestBefore(key)?cloneForward(latestBefore(key)):null);
    if(mm&&mm.groups){
      mm.groups.forEach(g=>(g.items||[]).forEach(i=>{
        if(!i.recurring||!i.dueDay)return;
        const dd=clampDay(y,mo,i.dueDay);
        const occ=new Date(y,mo,dd);
        if(occ>=from&&occ<=to) out.push({item:i,amount:i.planned||0,date:occ,monthKey:key,paid:realMonth&&itemPaid(i)});
      }));
    }
    mo++; if(mo>11){mo=0;y++;} guard++;
  }
  return out.sort((a,b)=>a.date-b.date);
}`);

replaceFunction("safeUntilPayday", `function safeUntilPayday(){
  const s=S.settings;
  const bb=billsBeforePayday(); if(!bb)return null;
  const pi=bb.info;
  const periods=s.payFrequency==="custom"?(30/(parseInt(s.customDays)||14)):(PERIODS_PER_MONTH[s.payFrequency]||1);
  const inferred=(parseFloat(s.monthlyIncome)||0)>0?(parseFloat(s.monthlyIncome)||0)/periods:0;
  const pay=nonNeg(s.payAmount)||inferred;
  if(pay<=0)return {needPay:true,info:pi};
  const periodDays=Math.max(1,dayDiff(pi.prev,pi.next));
  const savingsForPeriod=(parseFloat(s.savingsGoal)||0)*(periodDays/30);
  const periodBills=billOccurrencesBetween(pi.prev,pi.next);
  const billsTotal=periodBills.reduce((sum,o)=>sum+(o.amount||0),0);
  const spent=flexibleSpentBetween(pi.prev,pi.today);
  const left=pay-savingsForPeriod-billsTotal-spent;
  const days=Math.max(1,pi.daysUntil);
  return {pay,savingsForPeriod,billsTotal,unpaidTotal:bb.unpaidTotal,spent,left,perDay:Math.max(0,left)/days,daysUntil:pi.daysUntil,info:pi,over:left<-0.5,bb};
}`);

replaceFunction("billStatus", `function billStatus(i,monthKey){
  if(itemPaid(i))return {state:"paid",label:"Paid",color:"var(--teal)",bg:"var(--tealsoft)"};
  const today=todayLocal();
  const p=(monthKey||mk).split("-").map(Number);
  const y=p[0],mo=p[1]-1;
  if(i.dueDay){
    const due=new Date(y,mo,clampDay(y,mo,i.dueDay));
    if(due<today)return {state:"overdue",label:"Overdue",color:"var(--red)",bg:"var(--redsoft)",due};
    const dleft=dayDiff(today,due);
    if(dleft<=7)return {state:"soon",label:dleft===0?"Due today":"Due in "+dleft+"d",color:"var(--orange)",bg:"var(--orangesoft)",due};
    return {state:"upcoming",label:"Due "+dateLabel(due),color:"var(--dim)",bg:"var(--inset)",due};
  }
  return {state:"undated",label:"Set due date",color:"var(--orange)",bg:"var(--orangesoft)"};
}`);

replaceOnce('const st=billStatus(i);', 'const st=billStatus(i,mk);', "bill status selected month");

replaceOnce(
  'const catItems=OB.cats.filter(c=>c&&c.trim()).map(c=>({id:nid(),name:c.trim(),planned:0,actual:0,txns:[],recurring:false}));',
  'const catNames=OB.cats.filter(c=>c&&c.trim()).map(c=>c.trim());\n  const billTotal=billItems.reduce((s,b)=>s+(parseFloat(b.planned)||0),0);\n  const remainingForCategories=Math.max(0,income-goal-billTotal);\n  const evenAmount=catNames.length?Math.floor((remainingForCategories/catNames.length)*100)/100:0;\n  const catItems=catNames.map((c,idx)=>({id:nid(),name:c,planned:idx===catNames.length-1?Math.max(0,Math.round((remainingForCategories-evenAmount*(catNames.length-1))*100)/100):evenAmount,actual:0,txns:[],recurring:false}));',
  "onboarding suggested category amounts"
);

replaceOnce(
  '  S.settings.payAmount=parseFloat(OB.pay)||0;',
  '  S.settings.payAmount=parseFloat(OB.pay)||0;\n  S.settings.paycheckMode=!!(S.settings.nextPayday||S.settings.payAmount);',
  "onboarding paycheck mode"
);

replaceOnce(
  '    const moreActive=["more","bills","weekly","year"].includes(tab);',
  '    const moreActive=["more","debt","weekly","year"].includes(tab);',
  "more tab active state"
);
replaceOnce(
  '+\'<button data-tab="debt" class="\'+on("debt")+\'">\'+I.card+(tab==="debt"?\'<span>Debt</span>\':\'\')+\'</button>\'',
  '+\'<button data-tab="bills" class="\'+on("bills")+\'">\'+I.receipt+(tab==="bills"?\'<span>Bills</span>\':\'\')+\'</button>\'',
  "primary bills nav"
);
replaceOnce(
  '+moreRow("mBills",I.receipt,"Bills","Upcoming bills and due dates")\n    +moreRow("mWeekly",I.check,"Weekly review","A quick look at the last 7 days")',
  '+moreRow("mDebt",I.card,"Debt payoff","Avalanche or snowball payoff plan")\n    +moreRow("mBills",I.receipt,"Bills","Upcoming bills and due dates")\n    +moreRow("mWeekly",I.check,"Weekly review","A quick look at the last 7 days")',
  "debt in more menu"
);
replaceOnce(
  '  const md=document.getElementById("mBills");if(md)md.onclick=()=>{tab="bills";render();};',
  '  const mdebt=document.getElementById("mDebt");if(mdebt)mdebt.onclick=()=>{tab="debt";render();};\n  const md=document.getElementById("mBills");if(md)md.onclick=()=>{tab="bills";render();};',
  "debt more binding"
);

replaceOnce(
  '    mk=shiftMonth(mk,dir);\n    // moving forward into an empty month → auto-carry the latest prior plan\n    if(dir>0 && !S.months[mk]){\n      const src=latestBefore(mk);\n      if(src){S.months[mk]=cloneForward(src);save();}\n    }\n    render();',
  '    selectMonth(shiftMonth(mk,dir),dir>0);',
  "month arrow selection"
);
replaceOnce(
  'document.querySelectorAll("[data-pickmo]").forEach(b=>b.onclick=()=>{mk=b.dataset.pickmo;closeModal();render();});',
  'document.querySelectorAll("[data-pickmo]").forEach(b=>b.onclick=()=>{closeModal();selectMonth(b.dataset.pickmo,true);});',
  "month picker carry forward"
);
replaceOnce(
  'document.querySelectorAll("[data-goto]").forEach(el=>el.onclick=()=>{mk=el.dataset.goto;tab="budget";render();});',
  'document.querySelectorAll("[data-goto]").forEach(el=>el.onclick=()=>{tab="budget";selectMonth(el.dataset.goto,true);});',
  "year month selection"
);
replaceOnce(
  'if(e.key==="ArrowLeft"){mk=shiftMonth(mk,-1);render();}\n  else if(e.key==="ArrowRight"){\n    mk=shiftMonth(mk,1);\n    if(!S.months[mk]){const src=latestBefore(mk);if(src){S.months[mk]=cloneForward(src);save();}}\n    render();\n  }',
  'if(e.key==="ArrowLeft")selectMonth(shiftMonth(mk,-1),false);\n  else if(e.key==="ArrowRight")selectMonth(shiftMonth(mk,1),true);',
  "keyboard month selection"
);

replaceFunction("applyBackup", `function applyBackup(text,skipConfirm){
  try{
    if(!skipConfirm&&typeof confirm==="function"&&!confirm("Restore backup and replace current data? This overwrites everything currently in Allotted."))return false;
    const d=JSON.parse(text.trim());
    if(!d.months||typeof d.months!=="object")throw 0;
    S={schemaVersion:CURRENT_SCHEMA,months:{},bills:[],debts:[],settings:defaultSettings(),lastBackup:null,theme:"dark",lastLog:null};
    adoptState(d);
    migrate();
    closeModal();commit();toast("Backup restored");
    return true;
  }catch(e){toast("That text isn't a valid backup","var(--red)");return false;}
}`);
replaceOnce(
  'try{const d=JSON.parse(r.result);if(!d.months)throw 0;adoptState(d);migrate();closeModal();commit();toast("Backup restored");}\n    catch(err){toast("That file doesn\'t look like a valid backup","var(--red)");}',
  'applyBackup(r.result);',
  "file restore replace semantics"
);

replaceOnce(
  '+\'</div><div class="gv">\'+fmt(i.planned||0)+\'</div></div>\';',
  '+\'</div><div class="gv" style="color:\'+((i.planned||0)>0?"var(--text)":"var(--orange)")+\'">\'+((i.planned||0)>0?fmt(i.planned||0):"Set amount")+\'</div></div>\';',
  "zero amount budget hint"
);

replaceOnce(
  'h+=\'<button id="addBill" class="btn btn-teal" style="display:flex;align-items:center;justify-content:center;gap:8px;max-width:340px;margin:0 auto 16px">\'+I.plus+\' Add a bill</button>\';',
  'h+=\'<div class="card" style="padding:13px 15px;margin-bottom:14px;color:var(--dim);font-size:12.5px;line-height:1.5">Bills also appear in Budget under Spend. Paying a bill logs a transaction.</div>\';\n  h+=\'<button id="addBill" class="btn btn-teal" style="display:flex;align-items:center;justify-content:center;gap:8px;max-width:340px;margin:0 auto 16px">\'+I.plus+\' Add a bill</button>\';',
  "bills explanation"
);

replaceOnce(
  'S.debtPlan.extra=parseFloat(document.getElementById("ex_amt").value)||0;',
  'S.debtPlan.extra=nonNeg(document.getElementById("ex_amt").value);',
  "nonnegative extra debt payment"
);
replaceOnce(
  'const o={name,balance:parseFloat(document.getElementById("db_bal").value)||0,minPayment:parseFloat(document.getElementById("db_min").value)||0,apr:parseFloat(document.getElementById("db_apr").value)||0,dueDay:parseInt(document.getElementById("db_day").value)||0,notes:document.getElementById("db_note").value||""};',
  'const o={name,balance:nonNeg(document.getElementById("db_bal").value),minPayment:nonNeg(document.getElementById("db_min").value),apr:nonNeg(document.getElementById("db_apr").value),dueDay:parseInt(document.getElementById("db_day").value)||0,notes:document.getElementById("db_note").value||""};',
  "nonnegative debt fields"
);

replaceOnce(
  'load();\nsave();\nrender();',
  'load();\nif(!storageBroken)save();\nrender();\nif(storageBroken)setTimeout(()=>toast(storageWarning||"Allotted could not load or save local data","var(--red)"),800);',
  "safe startup save"
);

if (html !== readFileSync(file, "utf8")) {
  writeFileSync(file, html);
  console.log("Applied Allotted index fixes.");
} else {
  console.log("Allotted index fixes already applied.");
}
