// Day counts use calendar dates, so daylight-saving changes cannot shift a deadline.
function reminderDayNumber(value){const [y,m,d]=value.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;}
function reminderDueStatus(due,now=today()){
 const days=reminderDayNumber(due)-reminderDayNumber(now);
 return days<0?{kind:'overdue',text:`已逾期 ${-days} 天`}:days===0?{kind:'due-today',text:'今天到期'}:{kind:'upcoming',text:`还有 ${days} 天`};
}
function reminderDate(value){const [y,m,d]=value.split('-');return `${y!==today().slice(0,4)?y+'年':''}${Number(m)}月${Number(d)}日`;}
function reminderRow(item,completed=false){
 const due=reminderDueStatus(item.dueDate);
 return `<div class="reminder-row ${completed?'reminder-done':due.kind}"><label class="reminder-check"><input type="checkbox" data-reminder-check="${esc(item.id)}" aria-label="${esc((completed?'恢复事项：':'完成事项：')+item.title)}" ${completed?'checked':''}></label><div class="reminder-body"><strong>${esc(item.title)}</strong><small>到期：${reminderDate(item.dueDate)}</small>${item.note?`<p class="reminder-note">${esc(item.note)}</p>`:''}</div><div class="reminder-controls"><span class="reminder-badge">${completed?'已完成':due.text}</span>${!completed&&due.kind==='overdue'?'<small>未完成将持续显示</small>':''}<button class="reminder-edit secondary" data-reminder-edit="${esc(item.id)}" aria-label="${esc('编辑事项：'+item.title)}">编辑</button><button class="reminder-edit reminder-delete secondary" data-reminder-delete="${esc(item.id)}" aria-label="${esc('删除事项：'+item.title)}">删除</button></div></div>`;
}
function renderReminders(){
 const target=$('#reminder-section');if(!target)return;
 const active=reminders.data.filter(x=>!x.completed&&!x.deleted).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id));
 const done=reminders.data.filter(x=>x.completed&&!x.deleted).sort((a,b)=>b.dueDate.localeCompare(a.dueDate)||a.id.localeCompare(b.id));
 const trash=reminders.data.filter(x=>x.deleted);
 const trashOpen=Boolean($('#deleted-reminders')?.open);
 const wasOpen=Boolean($('#completed-reminders')?.open);
 target.innerHTML=`<div class="card reminder-card"><div class="toolbar reminder-heading"><div><h2>待办备忘</h2><span class="muted">${active.length} 项未完成</span></div><button id="add-reminder">＋ 添加事项</button></div><div class="reminder-list">${active.map(x=>reminderRow(x)).join('')||'<div class="reminder-empty">暂时没有待办事项。<br>记下重要的日子，让日常更从容。</div>'}</div><div class="reminder-footer"><span>完成后移出待办 · 逾期事项持续提醒</span><span>到期天数按今天计算</span></div><details id="completed-reminders" ${wasOpen?'open':''}><summary>已完成（${done.length}）</summary><div class="reminder-completed">${done.map(x=>reminderRow(x,true)).join('')||'<p class="muted">完成的事项会保留在这里，可随时恢复。</p>'}</div></details><details id="deleted-reminders" ${trashOpen?'open':''}><summary>已删除（${trash.length}）</summary><div class="reminder-completed">${trash.map(x=>`<div class="reminder-row reminder-done"><span aria-hidden="true">×</span><div class="reminder-body"><strong>${esc(x.title)}</strong><small>到期：${reminderDate(x.dueDate)} · ${x.completed?'已完成':'未完成'}</small></div><button class="secondary" data-reminder-restore="${esc(x.id)}" aria-label="${esc('恢复已删除事项：'+x.title)}">恢复</button></div>`).join('')||'<p class="muted">删除的事项会保留在这里，可随时恢复。</p>'}</div></details></div>`;
 target.querySelectorAll('[data-reminder-delete],[data-reminder-restore]').forEach(button=>button.onclick=async()=>{
  if(busy)return;
  const id=button.dataset.reminderDelete||button.dataset.reminderRestore;
  await saveReminders(reminders.data.map(x=>x.id===id?{...x,deleted:Boolean(button.dataset.reminderDelete)}:x));
 });
 $('#add-reminder').onclick=()=>editReminder();
 target.querySelectorAll('[data-reminder-edit]').forEach(button=>button.onclick=()=>editReminder(reminders.data.find(x=>x.id===button.dataset.reminderEdit)));
 target.querySelectorAll('[data-reminder-check]').forEach(input=>input.onchange=async()=>{
  if(busy){renderReminders();return;}
  input.disabled=true;
  await saveReminders(reminders.data.map(x=>x.id===input.dataset.reminderCheck?{...x,completed:input.checked}:x));
  renderReminders();
 });
}
function editReminder(item){
 if(busy)return;
 const form=$('#reminder-form');form.reset();$('#reminder-error').textContent='';
 form.elements.namedItem('id').value=item?.id||'';
 form.elements.namedItem('title').value=item?.title||'';
 form.elements.namedItem('dueDate').value=item?.dueDate||today();
 form.elements.namedItem('note').value=item?.note||'';
 $('#reminder-form-title').textContent=item?'编辑事项':'添加事项';
 $('#reminder-modal').showModal();form.elements.namedItem('title').focus();
}
async function saveReminders(data,close=false){
 await mutate(async()=>{
  try{reminders=await api('reminders',undefined,{data,sha:reminders.sha});}catch(error){if($('#reminder-modal').open)$('#reminder-error').textContent=error.message;throw error;}
  if(close)$('#reminder-modal').close();
  renderReminders();
 });
}
$('#reminder-cancel').onclick=()=>$('#reminder-modal').close();
$('#reminder-form').onsubmit=async event=>{
 event.preventDefault();if(busy)return;
 const fields=event.currentTarget.elements;
 const id=fields.namedItem('id').value||crypto.randomUUID();
 const title=fields.namedItem('title').value.trim();
 if(!title){$('#reminder-error').textContent='请输入事项名称';return;}
 const existing=reminders.data.find(x=>x.id===id);
 const item={id,title,dueDate:fields.namedItem('dueDate').value,note:fields.namedItem('note').value,completed:existing?.completed||false};
 await saveReminders([...reminders.data.filter(x=>x.id!==id),item],true);
};
// Repaint just this card after midnight or when returning to the tab; no polling API.
function refreshReminderDays(){if(page==='home'&&loggedIn()&&!busy&&!$('#reminder-modal').open)renderReminders();}
setInterval(refreshReminderDays,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshReminderDays();});
