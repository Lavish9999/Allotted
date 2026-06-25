import { readFileSync, writeFileSync, existsSync } from "node:fs";

const path = "www/index.html";
if (!existsSync(path)) process.exit(0);
let s = readFileSync(path, "utf8");

function replaceFunction(src, name, repl) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const brace = src.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let template = false;
  let escape = false;
  for (let i = brace; i < src.length; i++) {
    const c = src[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; template = c === "`"; continue; }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(0, start) + repl + src.slice(i + 1);
    }
  }
  throw new Error(`Could not find end of function ${name}`);
}

const openMoney = `function openMoney(kind,idv){let m=ensureMonth(),list=m[kind],x=idv?list.find(v=>v.id===idv):null,canDelete=kind==="savings"&&!!x;sheet((x?"Edit ":"Add ")+(kind==="income"?"income":"savings"),field("mn","Name",x?.name||"")+field("ma","Amount",x?.amount||"","number")+'<button id=saveMoney class="btn primary">Save</button>'+(canDelete?'<button id=deleteMoney class="btn warn">Delete savings line</button>':""));$("#saveMoney").onclick=()=>{let o=x||{id:id()};o.name=$("#mn").value||kind;o.amount=money($("#ma").value);if(!x)list.push(o);markPlanChange();closeModal();commit()};let del=$("#deleteMoney");if(del)del.onclick=()=>{if(confirm("Delete this savings line?")){m.savings=m.savings.filter(v=>v.id!==idv);markPlanChange();closeModal();commit()}}}`;

const openPaySettings = `function openPaySettings(){let s=S.settings;sheet("Income and paycheck",'<label class=field><span class=small>Safe-to-spend mode</span><select id=payMode><option value=month '+(!s.paycheckMode?"selected":"")+'>Use monthly plan only</option><option value=paycheck '+(s.paycheckMode?"selected":"")+'>Use paycheck mode</option></select></label><p class="small muted">Turn paycheck mode off when you want Allotted to ignore payday timing and use the whole month instead.</p>'+field("mincome","Monthly take-home income",s.monthlyIncome,"number")+field("sgoal","Monthly savings goal",s.savingsGoal,"number")+field("nextPay","Next payday",s.nextPayday,"date")+field("payAmt","Pay amount",s.payAmount,"number")+'<label class=field><span class=small>Pay frequency</span><select id=payFreq><option value=weekly '+(s.payFrequency==="weekly"?"selected":"")+'>Weekly</option><option value=biweekly '+(s.payFrequency==="biweekly"?"selected":"")+'>Biweekly</option><option value=monthly '+(s.payFrequency==="monthly"?"selected":"")+'>Monthly</option></select></label><button id=savePay class="btn primary">Save</button>');$("#savePay").onclick=()=>{s.monthlyIncome=money($("#mincome").value);s.savingsGoal=money($("#sgoal").value);s.nextPayday=$("#nextPay").value;s.payAmount=money($("#payAmt").value);s.payFrequency=$("#payFreq").value;s.paycheckMode=$("#payMode").value==="paycheck";markPlanChange();closeModal();commit()}}`;

const billTimeline = `function billTimeline(){let b=billItems(ensureMonth()).sort((a,b)=>(dueDateFor(a.item,mk)||new Date(8640000000000000))-(dueDateFor(b.item,mk)||new Date(8640000000000000)));if(!b.length)return'<div class=empty>No bills yet. Tap Add bill to set the amount, due date, and whether it repeats monthly.</div>';return'<div class=billTimeline>'+b.map(x=>{let i=x.item,st=billStatus(i,mk),due=dueDateFor(i,mk),needs=!due;return'<div class=billItem><div class=billRail><div class="billDot '+(itemPaid(i)?"paid":st.cls==="warn"?"warn":"")+'"></div></div><div class=billCard><div class=row><div class=meta><b>'+esc(i.name)+'</b><span class="small muted">'+paymentLabel(i)+' &middot; '+(due?due.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}):"No due date")+'</span><span class="pill '+st.cls+'">'+st.label+'</span></div><div class=value><div class=money>'+fmt(i.planned)+'</div><button class="btn miniBtn" data-edititem='+x.g.id+':'+i.id+'>'+(needs?"Set due date":"Edit")+'</button><button class="btn miniBtn" data-paybill='+x.g.id+':'+i.id+'>'+(itemPaid(i)?"Mark unpaid":"Mark paid")+'</button></div></div></div></div>'}).join("")+'</div>'}`;

const bills = `function bills(){let items=billItems(ensureMonth()),paid=items.filter(x=>itemPaid(x.item)).length,total=items.length,missing=items.filter(x=>!dueDateFor(x.item,mk)).length;return'<div class=screen><section class=surface><div class=sectionHead><div><div class=label>Bills timeline</div><div class=title>'+paid+' of '+total+' paid</div><p class=subtitle>Tap Add bill to set a due date while adding. Any bill missing a date now shows Set due date.</p></div><button id=addBill class="btn primary">Add bill</button></div>'+(missing?'<div class="chip warn">'+missing+' need due dates</div>':'<div class="chip good">Due dates set</div>')+'</section><section class=panel>'+billTimeline()+'</section></div>'}`;

s = replaceFunction(s, "openMoney", openMoney);
s = replaceFunction(s, "openPaySettings", openPaySettings);
s = replaceFunction(s, "billTimeline", billTimeline);
s = replaceFunction(s, "bills", bills);

for (const marker of ["Delete savings line", "Use monthly plan only", "Set due date", "Add bill"]) {
  if (!s.includes(marker)) throw new Error(`Patch marker missing: ${marker}`);
}

writeFileSync(path, s);
console.log("Applied Allotted requested fixes.");
