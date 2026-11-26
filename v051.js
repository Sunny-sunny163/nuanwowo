/* 暖窝窝 V0.5.1 — stable local execution workflow.
   Historical releases remain in archive/v0.4 and archive/v0.5. */
(function(){
'use strict';
const oldRenderStats=window.renderStats;
const previousSaveTaskEdit=window.saveTaskEdit;
const $=id=>document.getElementById(id);
const uid=()=> 'v51-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T12:00:00'))&&d<=today();
const minutes=v=>v===''?null:Number(v);
const validMinutes=v=>v===null||(Number.isFinite(v)&&v>=0&&v<=1440);
const clone=x=>JSON.parse(JSON.stringify(x));
const log=(type,before,after)=>{state.audit=Array.isArray(state.audit)?state.audit:[];state.audit.push({id:uid(),type,at:new Date().toISOString(),before:before?clone(before):null,after:after?clone(after):null})};
const primary=(e)=>e.extra!==true&&e.kindRecord!=='cancelled';
const entries=t=>state.events.filter(e=>e.taskId===t.id&&primary(e)).sort((a,b)=>b.date.localeCompare(a.date)||String(b.at||'').localeCompare(String(a.at||'')));
const latest=t=>entries(t)[0];
const human=e=>e.kind==='human'||(!e.kind&&!['保洁','机器人'].includes(e.executor));
const auditDate=()=>new Date().toISOString();
function setNextFromHistory(t,fallback){
 const last=latest(t);
 if(t.mode==='ondemand')return;
 if(t.mode==='once'){t.active=!last;return}
 if(!last){t.next=fallback||t.initialNext||t.next||today();return}
 if(t.mode==='interval')t.next=addDays(last.date,Math.max(1,Number(t.days)||1));
 if(t.mode==='daily')t.next=addDays(last.date,1);
}
function restorePlan(t,deleted){
 if(!t||t.mode==='ondemand')return;
 // A manual next-date override is never silently erased by edits to old history.
 if(t.manualScheduleOverride){return}
 const remaining=entries(t);
 if(!remaining.length){setNextFromHistory(t,deleted?.scheduleBefore||t.initialNext||today());return}
 setNextFromHistory(t);
}
function peopleFromEvent(ev){
 if(Array.isArray(ev.participants)&&ev.participants.length)return ev.participants.filter(p=>p&&typeof p.name==='string').map(p=>({name:p.name,minutes:p.minutes==null?null:Number(p.minutes)}));
 if(human(ev))return [{name:ev.executor==='另一位成员'?'另一位成员':'我',minutes:ev.minutes==null?null:Number(ev.minutes)}];
 return [];
}
let draft=null;
function showError(s){$('execError').textContent=s||''}
function openForm(id,existing=null,backfill=false){
 const task=state.tasks.find(x=>x.id===id);if(!task)return;
 const ev=existing?state.events.find(e=>e.id===existing):null;
 if(existing&&!ev)return;
 draft={taskId:id,eventId:existing||null,backfill};
 $('execTitle').textContent=(existing?'修改记录':backfill?'补录家务':'完成家务')+' · '+task.name;
 $('execDate').value=ev?.date||today();$('execDate').max=today();
 $('execMode').value=ev?.executionMode||(ev?.kind==='device'?'机器人':ev?.kind==='service'?'保洁':'人工');
 $('execMy').value='';$('execOther').value='';$('execExternal').value='';
 const people=ev?peopleFromEvent(ev):[];
 for(const p of people){if(p.name==='我')$('execMy').value=p.minutes??'';if(p.name==='另一位成员')$('execOther').value=p.minutes??''}
 if(ev&&(ev.kind==='device'||ev.kind==='service'))$('execExternal').value=ev.minutes??'';
 else if(ev&&people.length===0&&ev.minutes!=null)$('execMy').value=ev.minutes;
 else if(!existing&&state.timer?.taskId===id)$('execMy').value=Math.max(0,Math.round((Date.now()-Date.parse(state.timer.startedAt))/60000));
 $('execExtra').checked=!!ev?.extra;
 $('execExtra').disabled=!!existing;
 showError('');toggleExecFields();
 $('execOverlay').classList.remove('hide');
}
function toggleExecFields(){
 const service=['机器人','保洁'].includes($('execMode').value);
 $('execExternalField').classList.toggle('hide',!service);
 $('execExternalLabel').textContent=$('execMode').value==='机器人'?'机器人运行分钟数':'保洁服务分钟数';
 $('execPeopleTitle').textContent=service?'家庭成员准备/协助时间（选填）':'参与人员劳动时间（选填）';
}
function closeForm(){$('execOverlay').classList.add('hide');draft=null;showError('')}
function submitForm(){
 if(!draft)return;
 const t=state.tasks.find(x=>x.id===draft.taskId);
 const ev=draft.eventId?state.events.find(x=>x.id===draft.eventId):null;
 if(!t||draft.eventId&&!ev)return showError('找不到对应家务记录');
 const date=$('execDate').value,mode=$('execMode').value;
 if(!validDate(date))return showError('请选择今天或以前的有效日期');
 const my=minutes($('execMy').value),other=minutes($('execOther').value),external=minutes($('execExternal').value);
 if(!validMinutes(my)||!validMinutes(other)||!validMinutes(external))return showError('时间应在0至1440分钟之间，或留空');
 const service=['机器人','保洁'].includes(mode),kind=mode==='机器人'?'device':mode==='保洁'?'service':'human';
 const parts=[];if(my!==null)parts.push({name:'我',minutes:my});if(other!==null)parts.push({name:'另一位成员',minutes:other});
 let executor=service?mode:parts.length===2?'共同':parts.length===1?parts[0].name:ev?.executor||'我';
 // For unmeasured manual completions, retain who completed the chore.
 if(!service&&parts.length===0&&!['我','另一位成员','共同'].includes(executor))executor='我';
 const total=parts.length?parts.reduce((sum,p)=>sum+p.minutes,0):null;
 const existingSameDay=state.events.some(e=>e.id!==ev?.id&&e.taskId===t.id&&e.date===date&&primary(e));
 const extra=ev?!!ev.extra:($('execExtra').checked||existingSameDay);
 if(ev){
  const before=clone(ev);
  Object.assign(ev,{date,executionMode:mode,kind,executor,minutes:service?external:total,participants:parts});
  log('execution-edited',before,ev);
  if(!t.manualScheduleOverride&&!extra&&before.date!==date){restorePlan(t)}
 }else{
  const fresh={id:uid(),taskId:t.id,taskName:t.name,date,at:auditDate(),kindRecord:'complete',
   executionMode:mode,kind,executor,minutes:service?external:total,participants:parts,extra,
   scheduleBefore:t.next,backfill:!!draft.backfill};
  state.events.push(fresh);log('execution-created',null,fresh);
  if(t.mode==='once'&&!extra)t.active=false;
  if(!extra){
   if(!draft.backfill) t.manualScheduleOverride=false;
   const newest=latest(t);
   if(newest?.id===fresh.id)setNextFromHistory(t,fresh.scheduleBefore);
  }
  if(state.timer?.taskId===t.id)state.timer=null;
 }
 closeForm();save();
}
window.finish=id=>openForm(id);
window.backfill=id=>openForm(id,null,true);
window.editExecution=id=>{const ev=state.events.find(e=>e.id===id);if(ev)openForm(ev.taskId,id)};
window.deleteEvent=id=>{
 const e=state.events.find(x=>x.id===id);if(!e||!confirm('撤销该记录并更新统计？这项修改会保留审计记录。'))return;
 const t=state.tasks.find(x=>x.id===e.taskId);
 state.events=state.events.filter(x=>x.id!==id);log('execution-deleted',e,null);
 if(t)restorePlan(t,e);save();
};
window.toggleExecFields=toggleExecFields;
window.cancelExec=closeForm;
window.saveExec=submitForm;
const formerCalendar=window.renderCalendar;
window.renderCalendar=function(){
 formerCalendar();
 const es=state.events.filter(e=>e.date===selectedDay),el=$('dayrecords');
 if(es.length)el.innerHTML='<h3>'+selectedDay+' 执行记录</h3><div class="card">'+es.map(e=>
 '<div class="task"><div class="taskmain"><b>'+escapeHtml(e.taskName)+'</b><div class="muted">'+escapeHtml(e.executor||'未注明')+' · '+(e.minutes==null?'未记录时长':e.minutes+'分钟')+(e.extra?' · 额外执行':'')+'</div></div><div class="actions"><button class="secondary" onclick="editExecution(\''+e.id+'\')">修改</button><button class="ghost" onclick="deleteEvent(\''+e.id+'\')">撤销</button></div></div>'
 ).join('')+'</div>';
};
function normalizeForStats(){
 const all=[];
 for(const e of state.events){
  const parts=peopleFromEvent(e);
  if(human(e)){
    if(parts.length){for(const p of parts)all.push({...e,kind:'human',executor:p.name,minutes:p.minutes})}
    else all.push({...e,kind:'human',minutes:null});
  }else{
    all.push(e);
    for(const p of parts)all.push({...e,kind:'human',executor:p.name,minutes:p.minutes});
  }
 }
 return all;
}
window.renderStats=function(){
 const original=state.events;
 // No saved data mutation: only normalize a view of existing records.
 try{state.events=normalizeForStats();oldRenderStats()}finally{state.events=original}
};
window.saveTaskEdit=function(){
 const id=$('editId').value,t=state.tasks.find(x=>x.id===id),old=t?clone(t):null;
 previousSaveTaskEdit();
 if(!t||!old)return;
 if(t.mode!==old.mode||t.days!==old.days||t.next!==old.next){
  t.manualScheduleOverride=t.next!==old.next;
  log('schedule-edited',old,t);localStorage.setItem(KEY,JSON.stringify(state));
 }
};
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&draft)closeForm()});
if(!Array.isArray(state.audit))state.audit=[];
const oldImport=window.importData;
window.importData=async function(event){
 const file=event.target.files[0];if(!file)return;
 try{
  let data=JSON.parse(await file.text());
  if(!data||!Array.isArray(data.tasks)||!Array.isArray(data.events)||!Array.isArray(data.ideas))throw Error('缺少必要数组');
  if(data.tasks.length>5000||data.events.length>100000)throw Error('备份内容过大');
  if(data.events.some(x=>!x||typeof x.date!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date)))throw Error('执行记录格式错误');
  if(!confirm('导入将覆盖当前本地数据，建议先导出当前备份。确定继续吗？'))return;
  state={...data,audit:Array.isArray(data.audit)?data.audit:[],schemaVersion:51};
  save();
 }catch(err){alert('导入失败：'+err.message)}finally{event.target.value=''}
};
state.schemaVersion=51;
render();
})();
