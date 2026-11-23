/* 暖窝窝 V0.5 - 执行记录与周期修复。保留 V0.4 JSON 数据格式。 */
(function(){
'use strict';
const genId=()=> 'e'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
const finiteM=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&v<=today();
const hist=()=>{if(!Array.isArray(state.audit))state.audit=[];return state.audit};
function audit(action,event,before){hist().push({id:genId(),at:new Date().toISOString(),action,eventId:event.id,taskId:event.taskId,before:before||null,after:JSON.parse(JSON.stringify(event))})}
function isHuman(e){return e.kind==='human'||(!e.kind&&!['机器人','保洁'].includes(e.executor))}
function effective(e){return e.kind==='complete'||e.kind==null}
function validTask(t){return t&&state.tasks.includes(t)}
function recent(t){return state.events.filter(e=>e.taskId===t.id&&effective(e)&&e.extra!==true).sort((a,b)=>b.date.localeCompare(a.date)||String(b.at||'').localeCompare(String(a.at||'')))[0]}
function replan(t,fallback){
  if(t.mode==='ondemand')return;
  if(t.mode==='once'){t.active=!recent(t);return}
  const last=recent(t);
  if(!last){if(fallback)t.next=fallback;return}
  if(t.mode==='daily'){t.next=addDays(last.date,1);if(t.next<today())t.next=today();return}
  if(t.mode==='interval'){t.next=addDays(last.date,Number(t.days)||7)}
}
function sameDayPrimary(t,date){return state.events.some(e=>e.taskId===t.id&&e.date===date&&effective(e)&&!e.extra)}
function choice(label,defaultValue){return prompt(label,defaultValue)}
function getMinutes(label,guess){const val=choice(label,guess==null?'':String(guess));if(val===null)return undefined;if(val.trim()==='')return null;let n=Number(val);if(!finiteM(n)||n>1440){alert('请输入0到1440分钟，或留空不计时');return undefined}return n}
function collectParts(initial){
  const mode=choice('执行方式：人工 / 工具辅助 / 机器人 / 保洁','人工');
  if(mode===null)return null;
  if(!['人工','工具辅助','机器人','保洁'].includes(mode.trim())){alert('请选择有效的执行方式');return null}
  const type=mode.trim();
  if(type==='机器人'||type==='保洁'){
    const mins=getMinutes(type==='机器人'?'设备运行分钟数':'本次保洁服务分钟数','');
    if(mins===undefined)return null;
    let prep=getMinutes('家庭成员准备/协助时间（分钟，可留空）','');if(prep===undefined)return null;
    let people=prep===null?[]:[{name:'我',minutes:prep}];
    return {kind:type==='机器人'?'device':'service',executor:type,minutes:mins,participants:people,executionMode:type};
  }
  const who=choice('参与人员：我 / 另一位成员 / 共同',initial||'我');if(who===null)return null;
  if(!['我','另一位成员','共同'].includes(who.trim())){alert('请输入我、另一位成员或共同');return null}
  const names=who.trim()==='共同'?['我','另一位成员']:[who.trim()];
  const participants=[];
  for(let name of names){let m=getMinutes(name+'的人工劳动分钟数（可留空）','');if(m===undefined)return null;participants.push({name,minutes:m})}
  const total=participants.every(p=>p.minutes===null)?null:participants.reduce((sum,p)=>sum+(p.minutes||0),0);
  return {kind:'human',executor:who.trim(),minutes:total,participants,executionMode:type};
}
window.finish=function(id){
 const t=state.tasks.find(x=>x.id===id);if(!validTask(t))return;
 let timed=state.timer?.taskId===id?Math.max(0,Math.round((Date.now()-Date.parse(state.timer.startedAt))/60000)):null;
 let parts=collectParts(t.owner==='共同'?'我':t.owner);if(!parts)return;
 if(timed!==null&&parts.kind==='human'&&parts.participants.length===1&&parts.participants[0].minutes===null){parts.participants[0].minutes=timed;parts.minutes=timed}
 const d=today(),isExtra=t.mode!=='ondemand'&&(!due(t)||sameDayPrimary(t,d));
 const old=t.next;const ev={id:genId(),taskId:t.id,taskName:t.name,date:d,at:new Date().toISOString(),...parts,extra:isExtra,kindRecord:'complete'};
 state.events.push(ev);audit('created',ev);
 if(state.timer?.taskId===id)state.timer=null;
 if(!isExtra){if(t.mode==='once')t.active=false;else if(t.mode==='daily')t.next=addDays(d,1);else if(t.mode==='interval')t.next=addDays(d,t.days)}
 else if(t.mode!=='ondemand')t.next=old;
 save();
};
window.backfill=function(id){
 const t=state.tasks.find(x=>x.id===id);if(!validTask(t))return;
 let d=choice('实际完成日期 YYYY-MM-DD',today());if(d===null)return;
 if(!validDate(d)){alert('请输入今天或以前的有效日期');return}
 let parts=collectParts('我');if(!parts)return;
 const hasLater=state.events.some(e=>e.taskId===id&&effective(e)&&e.date>d);
 const extra=t.mode!=='ondemand'&&sameDayPrimary(t,d);
 const ev={id:genId(),taskId:id,taskName:t.name,date:d,at:new Date().toISOString(),...parts,extra,backfill:true,kindRecord:'complete'};
 state.events.push(ev);audit('backfilled',ev);
 if(t.mode==='interval'&&!hasLater&&!extra&&confirm('是否从这次补录日期重新计算下一次家务日期？'))replan(t);
 save();
};
window.deleteEvent=function(id){
 let ev=state.events.find(e=>e.id===id);if(!ev||!confirm('撤销这条记录？记录将从统计中移除，并重新核对后续周期。'))return;
 const t=state.tasks.find(x=>x.id===ev.taskId),before=JSON.parse(JSON.stringify(ev));
 state.events=state.events.filter(e=>e.id!==id);audit('deleted',ev,before);
 if(t&&ev.extra!==true&&t.mode==='interval'){replan(t,ev.scheduleBefore||t.next)}
 if(t&&t.mode==='once')replan(t);
 save();
};
window.editExecution=function(id){
 const ev=state.events.find(e=>e.id===id);if(!ev)return;
 const before=JSON.parse(JSON.stringify(ev));
 let d=choice('实际执行日期 YYYY-MM-DD',ev.date);if(d===null)return;
 if(!validDate(d)){alert('日期无效');return}
 let parts=collectParts(ev.executor==='共同'?'我':ev.executor);if(!parts)return;
 ev.date=d;ev.at=ev.at||new Date().toISOString();
 Object.assign(ev,parts);
 audit('edited',ev,before);
 const t=state.tasks.find(x=>x.id===ev.taskId);
 if(t&&ev.extra!==true&&t.mode==='interval')replan(t);
 save();
};
const oldCalendar=window.renderCalendar;
window.renderCalendar=function(){
 oldCalendar();
 const el=document.getElementById('dayrecords');const es=state.events.filter(e=>e.date===selectedDay);
 if(!es.length)return;
 el.innerHTML='<h3>'+selectedDay+' 执行记录</h3><div class="card">'+es.map(e=>'<div class="task"><div class="taskmain"><b>'+escapeHtml(e.taskName)+'</b><div class="muted">'+escapeHtml(e.executor)+' · '+(e.minutes==null?'未记录时长':e.minutes+'分钟')+(e.extra?' · 额外执行':'')+'</div></div><div class="actions"><button class="secondary" onclick="editExecution(\''+e.id+'\')">修改</button><button class="ghost" onclick="deleteEvent(\''+e.id+'\')">撤销</button></div></div>').join('')+'</div>';
};
const oldRenderStats=window.renderStats;
window.renderStats=function(){
 // V0.4 的统计只认识每条记录的一个执行人，先把新结构按参与人员拆分后再计算。
 const raw=state.events;
 let normalized=[];
 for(const e of raw){
   if(isHuman(e)&&Array.isArray(e.participants)&&e.participants.length){
     for(const p of e.participants)normalized.push({...e,executor:p.name,minutes:p.minutes,kind:'human'});
   }else if(!isHuman(e)&&Array.isArray(e.participants)&&e.participants.length){
     normalized.push(e);
     for(const p of e.participants)normalized.push({...e,executor:p.name,minutes:p.minutes,kind:'human'});
   }else normalized.push(e);
 }
 state.events=normalized;
 try{oldRenderStats()}finally{state.events=raw}
};
const oldSaveTaskEdit=window.saveTaskEdit;
window.saveTaskEdit=function(){
 const id=document.getElementById('editId').value;
 const t=state.tasks.find(x=>x.id===id),old=t&&{...t};
 oldSaveTaskEdit();
 if(t&&old&&(t.next!==old.next||t.days!==old.days||t.mode!==old.mode)){hist().push({id:genId(),at:new Date().toISOString(),action:'schedule-changed',taskId:t.id,before:old,after:{...t}});localStorage.setItem(KEY,JSON.stringify(state))}
};
})();
