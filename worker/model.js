export const defaults = ['餐饮','交通','购物','生活','其他'];
export function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s; }
export function filePath(kind,date) { if (!['cost','daily'].includes(kind) || !validDate(date)) throw new Error('日期无效'); return `${kind}/${date.slice(0,4)}/${date.slice(5,7)}/${date}.${kind==='cost'?'json':'md'}`; }
export function validate(kind,data) {
 if(kind==='cost') {
  if(!Array.isArray(data)||data.length>1000) throw new Error('记录数量无效');
  const ids=new Set(); for(const x of data){if(!x || typeof x.id!=='string'||! /^[a-zA-Z0-9-]{1,80}$/.test(x.id)||ids.has(x.id)|| !Number.isSafeInteger(x.amountCents)||x.amountCents<1||x.amountCents>9999999900||typeof x.tag!=='string'||!x.tag.trim()||x.tag.length>40||typeof x.note!=='string'||x.note.length>500||!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))throw new Error('账单字段无效');ids.add(x.id);}
 } else if(kind==='daily') { if(!data||typeof data.zh!=='string'||typeof data.en!=='string'||data.zh.length+data.en.length>100000)throw new Error('日记字段无效'); }
 else if(kind==='tags') {if(!Array.isArray(data)||data.length>100||new Set(data).size!==data.length||data.some(x=>typeof x!=='string'||!x.trim()||x.length>40))throw new Error('标签无效');}
 return data;
}
// JSON metadata preserves arbitrary Markdown (including headings and delimiters).
export function encodeDiary(data){return `<!-- life-notebook:${JSON.stringify(data)} -->\n\n# 中文\n\n${data.zh}\n\n# English\n\n${data.en}\n`;}
export function decodeDiary(text){const line=text.split('\n')[0];if(!line.startsWith('<!-- life-notebook:')||!line.endsWith(' -->'))throw new Error('日记格式无法识别，请保留文件首行元数据');return validate('daily',JSON.parse(line.slice(19,-4)));}
export function total(items){return items.reduce((s,x)=>s+x.amountCents,0);}
