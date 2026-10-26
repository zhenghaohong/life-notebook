const {readFileSync}=require('node:fs');
const vm=require('node:vm');const assert=require('node:assert/strict');
const context=vm.createContext({$:()=>({}),setInterval(){},document:{addEventListener(){}},today:()=> '2026-10-26'});
vm.runInContext(readFileSync(__dirname+'/web/reminders.js','utf8'),context);
for(const [due,now,text] of [['2026-10-24','2026-10-26','已逾期 2 天'],['2026-10-26','2026-10-26','今天到期'],['2026-10-29','2026-10-26','还有 3 天'],['2027-01-01','2026-12-31','还有 1 天'],['2028-03-01','2028-02-28','还有 2 天'],['2026-03-09','2026-03-08','还有 1 天']]){
 assert.equal(vm.runInContext(`reminderDueStatus('${due}','${now}').text`,context),text);
}
console.log('Reminder calendar-day tests passed (overdue, today, upcoming, year boundary, leap day, DST)');
