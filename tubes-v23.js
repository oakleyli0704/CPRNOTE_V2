/* CPR NOTE V2.3 — incremental tube designer. Loaded after the unchanged V2.2 flows. */
'use strict';
const v23Types = {number:'數字輸入',select:'下拉選單',text:'文字輸入'};
const v23TypeLabel = type => v23Types[type==='number_unit'?'number':type] || '文字輸入';
const v23Clone = x => JSON.parse(JSON.stringify(x));
const v23Attr = x => escapeHtml(String(x ?? ''));
const v23Key = () => 'f_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'') : Date.now().toString(36)+Math.random().toString(36).slice(2));
const v23Fields = t => (Array.isArray(t.fields) ? t.fields : Array.isArray(t.field_schema) ? t.field_schema : []).filter(f=>f.active!==false);
function v23Options(f, units=false) {
    return (units ? f.units || (f.unit ? [f.unit] : []) : f.options || []).map((o,i)=> typeof o==='object' && o!==null ? { ...o, value:String(o.value ?? o.label ?? ''), label:String(o.label ?? o.value ?? ''), active:o.active!==false } : {value:String(o),label:String(o),active:true,id:'legacy_'+i});
}
function v23ChoiceValid(v, opts) {return v!==null && v!==undefined && v!=='' && opts.some(o=>o.active && o.value===String(v));}
function v23Default(f, defs={}) {
    const owns=Object.prototype.hasOwnProperty.call(defs,f.key), global=f.default ?? '';
    const candidate=owns ? defs[f.key] : global;
    if(candidate===null) return f.type==='number_unit' ? {value:'',unit:''} : '';
    if(f.type==='select') {
        const options=v23Options(f);
        return v23ChoiceValid(candidate,options) ? String(candidate) : v23ChoiceValid(global,options) ? String(global) : '';
    }
    if(f.type==='number_unit') {
        const g=typeof global==='object' && global!==null ? global : {value:global,unit:f.default_unit??f.unit??''};
        const c=typeof candidate==='object' && candidate!==null ? candidate : {value:candidate,unit:g.unit};
        const opts=v23Options(f,true);
        return {value:c.value ?? '',unit:v23ChoiceValid(c.unit,opts) ? String(c.unit) : v23ChoiceValid(g.unit,opts) ? String(g.unit) : ''};
    }
    return candidate ?? '';
}
function v23Select(options, val, attrs='', blank='請選擇') {
    return `<select class="v17-input" ${attrs}><option value="">${v23Attr(blank)}</option>${options.filter(o=>o.active).map(o=>`<option value="${v23Attr(o.value)}" ${String(val)===o.value?'selected':''}>${v23Attr(o.label)}</option>`).join('')}</select>`;
}
function v23Controls(f,value, prefix, attrs='') {
    const number=f.type==='number'||f.type==='number_unit';
    if(f.type==='select') return v23Select(v23Options(f),value,`id="${v23Attr(prefix)}" ${attrs}`);
    const val=f.type==='number_unit' ? value.value : value;
    const input=`<input class="v17-input" id="${v23Attr(prefix)}" type="${number?'number':'text'}" ${number?'step="any" min="0" inputmode="decimal"':''} value="${v23Attr(val)}" ${attrs}>`;
    return f.type==='number_unit' ? `<div class="v23-number-unit">${input}${v23Select(v23Options(f,true),value.unit,`id="${v23Attr(prefix)}-unit" ${attrs}`,'單位')}</div>` : input;
}
function v23ReadControl(f,prefix,root=document) {
    const el=root.querySelector(`[id="${prefix}"]`);
    if(!el) throw new Error('找不到管路輸入欄位');
    let value=el.value.trim();
    if(value!=='' && (f.type==='number'||f.type==='number_unit'||(f.type==='select'&&f.value_type==='number'))) {
        if(!Number.isFinite(Number(value)) || Number(value)<0) throw new Error(`${f.label}請輸入有效的非負數字`);
        value=Number(value);
    }
    if(f.type==='select' && value!=='' && !v23ChoiceValid(value,v23Options(f))) throw new Error(`${f.label}選項已停用，請重新選擇`);
    if(f.type==='number_unit') {
        const unit=root.querySelector(`[id="${prefix}-unit"]`).value;
        if(unit && !v23ChoiceValid(unit,v23Options(f,true))) throw new Error(`${f.label}單位已停用`);
        if(value!=='' && !unit) throw new Error(`${f.label}請選擇單位`);
        return {value,unit};
    }
    return value;
}
function v23Describe(f,value) {
    if(f.type==='number_unit') {
        const unit=v23Options(f,true).find(o=>o.value===String(value.unit))?.label ?? value.unit;
        return value.value==='' ? (unit ? `單位 ${unit}` : '未設定') : `${value.value} ${unit||''}`.trim();
    }
    if(value===''||value===null) return '未設定';
    return f.type==='select' ? (v23Options(f).find(o=>o.value===String(value))?.label ?? value) : `${value}${f.unit?' '+f.unit:''}`;
}
// Draft schemas live on their DOM row; removed items are retained as inactive.
function v23SchemaRow(f) {
    const row=document.createElement('div');row.className='v23-schema-row';row.dataset.schemaRow='';row.dataset.v23ControlId=v23Key();row._field=v23Clone(f);
    v23DrawSchemaRow(row);return row;
}
function v23DrawSchemaRow(row) {
    const f=row._field, active=f.active!==false;
    row.classList.toggle('v23-field-off',!active);
    row.innerHTML=`<div class="v23-field-head"><button type="button" class="v23-field-toggle" onclick="v23ExpandField(this)" aria-expanded="${row._expanded?'true':'false'}" aria-controls="v23-body-${row.dataset.v23ControlId}"><strong data-row-title>${v23Attr(f.label||'新增欄位')}</strong><span data-row-summary>${v23Attr(v23FieldSummary(f))}</span></button><div class="v23-row-actions"><button type="button" onclick="v23MoveField(this,-1)" aria-label="欄位上移" title="欄位上移">↑</button><button type="button" onclick="v23MoveField(this,1)" aria-label="欄位下移" title="欄位下移">↓</button><button type="button" onclick="v23ToggleField(this)">${active?'停用欄位':'恢復欄位'}</button></div></div>
      <div data-field-body id="v23-body-${row.dataset.v23ControlId}" ${row._expanded?'':'hidden'}><div class="v23-setting-section"><h3>基本資料</h3><div class="v23-editor-grid"><label>欄位名稱<input class="v17-input" data-label value="${v23Attr(f.label)}"></label><label>輸入方式<select class="v17-input" data-type onchange="v23ChangeType(this)">${Object.entries(v23Types).map(([k,v])=>`<option value="${k==='number'&&f.type==='number_unit'?'number_unit':k}" ${(f.type==='number_unit'?'number':f.type)===k?'selected':''}>${v}</option>`).join('')}</select></label><label>${f.type==='number_unit'?'可用單位':'單位（可留白）'}<input class="v17-input" data-unit value="${v23Attr(f.type==='number_unit'?v23Options(f,true).filter(o=>o.active).map(o=>o.label).join('、'):f.unit)}" ${f.type==='number_unit'?'readonly':''} placeholder="例如 cm、mm、Fr">${f.type==='number_unit'?'<button type="button" class="v23-link" onclick="v23OpenOptions(this)">管理單位與排序</button>':''}</label></div></div>
      <div class="v23-setting-section"><h3>預設內容</h3><label class="v17-label">全院預設值</label>${v23Controls(f,v23Default(f),'v23-global-'+row.dataset.v23ControlId,'data-global-default')}${f.type==='select'?`<div class="v23-options-summary"><div>選項：${v23Options(f).filter(o=>o.active).map(o=>v23Attr(o.label)).join('、')||'尚未設定'}</div><button type="button" class="v23-link" onclick="v23OpenOptions(this)">管理選項與排序</button><label class="v23-check"><input type="checkbox" data-numeric ${f.value_type==='number'?'checked':''}>選項是數字（例如 Fr、號數）</label></div>`:''}</div>
      <div class="v23-setting-section"><h3>填寫規則</h3><label class="v23-check"><input type="checkbox" data-required ${f.required?'checked':''}>此欄位必填</label></div>
      <details class="v23-code"><summary>系統代碼</summary><input class="v17-input v22-code-locked" data-key readonly value="${v23Attr(f.key)}"></details></div>`;
}
function v23FieldSummary(f){return `${v23TypeLabel(f.type)} · 預設 ${v23Describe(f,v23Default(f))} · ${f.active===false?'停用':f.required?'必填':'選填'}`;}
function v23ExpandField(el){const row=el.closest('[data-schema-row]'),open=!row._expanded;row.parentNode.querySelectorAll('[data-schema-row]').forEach(r=>{r._expanded=false;r.querySelector('[data-field-body]').hidden=true;r.querySelector('.v23-field-toggle').setAttribute('aria-expanded','false');});row._expanded=open;row.querySelector('[data-field-body]').hidden=!open;el.setAttribute('aria-expanded',String(open));}
function v23ReadRow(row,validate=true) {
    const f={...row._field,key:row.querySelector('[data-key]').value,label:row.querySelector('[data-label]').value.trim(),type:row.querySelector('[data-type]').value,unit:row.querySelector('[data-unit]').value.trim(),required:row.querySelector('[data-required]').checked};
    f.value_type=row.querySelector('[data-numeric]')?.checked ? 'number' : (f.type==='number'||f.type==='number_unit'?'number':'text');
    if(validate) f.default=v23ReadControl(f,'v23-global-'+row.dataset.v23ControlId,row);
    else {try{f.default=v23ReadControl(row._field,'v23-global-'+row.dataset.v23ControlId,row);}catch{f.default=v23Default(row._field);}}
    if(validate) {
        if(!f.label)throw new Error('欄位顯示名稱必填');
        if(!/^[a-zA-Z0-9_-]+$/.test(f.key))throw new Error('欄位系統代碼只能使用英數字、底線或連字號');
        if(f.active!==false && (f.type==='select'||f.type==='number_unit')&&!v23Options(f,f.type==='number_unit').some(o=>o.active))throw new Error(`${f.label}至少需要一個啟用的${f.type==='select'?'選項':'單位'}`);
    }
    if(validate&&f.type==='select'&&f.value_type==='number'&&v23Options(f).some(o=>o.active&&(!Number.isFinite(Number(o.value))||Number(o.value)<0||Number(o.label)!==Number(o.value))))throw new Error(`${f.label}的數字選項需為有效數字，修改尺寸請停用舊項並新增`);
    if(f.type==='number_unit') f.unit='';
    return f;
}
function v23Mark(el) {v18MarkAdminCard(el);v23RefreshTubeList();}
function v23ChangeType(el) {
    const row=el.closest('[data-schema-row]');const old=row._field;
    const current=row.querySelector('[data-global-default]')?.value??'';
    const next=v23ReadRow(row,false);next.type=el.value;if(next.type==='select'&&['number','number_unit'].includes(old.type))next.value_type='number';
    if(next.type==='number_unit') {next.units=v23Options(old,true);next.default={value:current,unit:next.units.find(o=>o.active)?.value??''};next.unit='';}
    else {next.default=next.type==='select'?(v23ChoiceValid(current,v23Options(next))?current:''):current;}
    row._field=next;v23DrawSchemaRow(row);v23Mark(row);
}
function v23MoveField(el,dir) {const row=el.closest('[data-schema-row]'),other=dir<0?row.previousElementSibling:row.nextElementSibling;if(!other)return;if(dir<0)row.parentNode.insertBefore(row,other);else row.parentNode.insertBefore(other,row);v23Mark(row);}
function v23ToggleField(el) {
    const row=el.closest('[data-schema-row]');
    try {row._field=v23ReadRow(row);row._field.active=row._field.active===false;v23DrawSchemaRow(row);v23Mark(row);}catch(e){alertV17(e.message,true);}
}
v22TubeFieldHeader=()=>'<p class="v17-section-note">欄位依上到下顯示；↑↓調整順位。停用會保留歷史紀錄，儲存後生效。</p>';
v18FieldRows=function(t){return (t.field_schema||[]).map(f=>v23SchemaRow({...f,type:v23Types[f.type]||f.type==='number_unit'?f.type:'text'}).outerHTML).join('');};
// outerHTML cannot carry JS properties; hydrate from the returned master data below.
const v23OriginalAdminLoad=loadAdminTubesBlood;
loadAdminTubesBlood=async function(){
    if(desktopProfile?.role!=='admin') return;
    await v23OriginalAdminLoad();
    const root=adminRoot();
    const {data,error}=await supabaseClient.from('tube_types').select('*').order('sort_order').order('name');
    if(error) {root.innerHTML=`<p class="text-red-700">管路設定讀取失敗：${v23Attr(error.message)}</p>`;return;}
    const code=root.querySelector('#admin-tube-code');
    if(code) {code.placeholder='留白由系統產生';code.previousElementSibling.textContent='管路代碼（可留白）';}
    root.querySelectorAll('[data-v18-tube]').forEach(card=>{
        const t=data.find(t=>String(t.id)===card.dataset.v18Tube);if(!t)return;
        const box=card.querySelector('[id^="v18-tube-fields-"]');box.replaceChildren(...(t.field_schema||[]).map(f=>v23SchemaRow({...f,type:v23Types[f.type]||f.type==='number_unit'?f.type:'text'})));
        card.closest('.v177-card-grid')?.classList.add('v23-designer-grid');
        card.insertAdjacentHTML('beforeend',`<div class="v17-actions"><button class="v17-btn v17-btn-secondary" onclick="v23PreviewTube(this)">預覽前端</button><button class="v17-btn v17-btn-primary" onclick="saveAllV18Tubes(this,'${v23Attr(t.id)}')">儲存 ${v23Attr(t.name)}</button></div>`);
    });
    const grid=root.querySelector('.v23-designer-grid');
    if(grid){const workspace=document.createElement('div');workspace.className='v23-workspace';grid.before(workspace);workspace.innerHTML='<div class="v23-tube-list" aria-label="管路清單"></div><div class="v23-editor-pane"><div class="v23-editor-empty">選擇管路開始編輯</div></div>';workspace.querySelector('.v23-editor-pane').appendChild(grid);grid.querySelectorAll('[data-v18-tube]').forEach(card=>card.hidden=true);v23RefreshTubeList();}
    root.addEventListener('input',v23AdminDirty);root.addEventListener('change',v23AdminDirty);
};
function v23RefreshTubeList(){const root=adminRoot(),list=root.querySelector('.v23-tube-list');if(!list)return;list.innerHTML=[...root.querySelectorAll('[data-v18-tube]')].map(card=>{const id=card.dataset.v18Tube,name=card.querySelector('[id^="tube-name-"]').value,active=card.querySelector('[id^="tube-active-"]').checked,count=[...card.querySelectorAll('[data-schema-row]')].filter(r=>r._field.active!==false).length;return `<button type="button" class="v23-tube-item ${card.hidden?'':'v23-selected'}" data-edit-tube="${v23Attr(id)}" onclick="v23EditTube(this.dataset.editTube)" aria-pressed="${!card.hidden}"><strong>${v23Attr(name||'未命名管路')}</strong><span>${count} 個欄位 · ${active?'啟用':'停用'}${card.dataset.v18Dirty==='1'?' · 未儲存':''}</span><span class="v23-edit-label">編輯 →</span></button>`;}).join('')||'<p class="v17-section-note">尚未新增管路</p>';}
function v23EditTube(id){const root=adminRoot();root.querySelectorAll('[data-v18-tube]').forEach(card=>card.hidden=card.dataset.v18Tube!==id);root.querySelector('.v23-editor-empty').hidden=true;v23RefreshTubeList();if(matchMedia('(max-width:800px)').matches)root.querySelector(`[data-v18-tube="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});}
function v23AdminDirty(e) {if(e.target.closest('[data-v18-tube]')){v23Mark(e.target);const row=e.target.closest('[data-schema-row]');if(row){row.querySelector('[data-row-title]').textContent=row.querySelector('[data-label]').value||'新增欄位';row.querySelector('[data-row-summary]').textContent=v23FieldSummary(v23ReadRow(row,false));}}}
v18AddTubeField=function(id){const box=document.getElementById(`v18-tube-fields-${id}`);if(!box)return;const row=v23SchemaRow({key:v23Key(),label:'',type:'number',default:'',active:true});box.appendChild(row);v23ExpandField(row.querySelector('.v23-field-toggle'));row.querySelector('[data-label]').focus();v23Mark(box);};
adminAddTube=async function(){
    if(desktopProfile?.role!=='admin')return;
    const name=document.getElementById('admin-tube-name').value.trim(),code=document.getElementById('admin-tube-code').value.trim().toLowerCase()||'tube_'+v23Key();
    if(!name||!/^[a-z0-9_-]+$/.test(code))return alertV17('請填管路名稱；代碼可留白，或使用英數字、底線、連字號',true);
    if(document.querySelector('[data-v18-dirty="1"]'))return alertV17('請先儲存目前變更，再新增管路',true);
    const {error}=await supabaseClient.from('tube_types').insert({code,name,sort_order:Number(document.getElementById('admin-tube-sort').value)||v17NextTubeSort,field_schema:[],is_active:false});
    if(error)return alertV17(error.message,true);alertV17(`${name} 已新增為停用，請完成欄位後啟用`);await loadAdminTubesBlood();const added=[...adminRoot().querySelectorAll('[data-v18-tube]')].find(card=>card.querySelector('[id^="tube-name-"]').value===name);if(added)v23EditTube(added.dataset.v18Tube);
};
saveAllV18Tubes=async function(btn,onlyId){
    if(desktopProfile?.role!=='admin')return;
    const cards=[...document.querySelectorAll('[data-v18-tube][data-v18-dirty="1"]')].filter(c=>!onlyId||c.dataset.v18Tube===onlyId);
    if(!cards.length)return alertV17('管路設定沒有需要儲存的變更');
    setV17ButtonBusy(btn,true,'儲存中...');
    try {
        // Validate every card before writing any, so input errors do not partly save a batch.
        const items=cards.map(card=>{
            const id=card.dataset.v18Tube,schema=[...card.querySelectorAll('[data-schema-row]')].map((r,i)=>({...v23ReadRow(r),sort_order:i+1})),name=document.getElementById(`tube-name-${id}`).value.trim(),sort=Number(document.getElementById(`tube-sort-${id}`).value),active=document.getElementById(`tube-active-${id}`).checked;
            if(!name||!Number.isInteger(sort)||sort<0)throw new Error('請填顯示名稱及有效的非負整數排序');
            if(new Set(schema.map(f=>f.key)).size!==schema.length)throw new Error('同一管路欄位代碼不可重複');
            if(active&&!schema.some(f=>f.active!==false))throw new Error(`${name}需至少一個啟用欄位`);
            return {card,id,payload:{name,sort_order:sort,is_active:active,field_schema:schema}};
        });
        for(const item of items){const {error}=await supabaseClient.from('tube_types').update(item.payload).eq('id',item.id);if(error)throw error;item.card.dataset.v18Dirty='0';}
        v18MarkAdminCard(document.createElement('div'));v23RefreshTubeList();alertV17(`管路設定已更新，共 ${items.length} 項；下次 CPR 載入新設定`);
        // Do not reload the whole page: preserve unsaved cards and blood settings.
    }catch(e){alertV17(`儲存失敗：${e.message}；尚未儲存的卡片仍保留`,true);}finally{setV17ButtonBusy(btn,false);}
};
// Option editor: stable values, rename labels, soft-disable, explicit order, draft-only save.
let v23OptionEditor=null;
function v23Modal() {
    let modal=document.getElementById('v23-designer-modal');
    if(!modal){modal=document.createElement('dialog');modal.id='v23-designer-modal';modal.className='v23-modal';modal.addEventListener('close',()=>{v23OptionEditor=null;});document.body.appendChild(modal);}
    return modal;
}
function v23OpenOptions(el){const row=el.closest('[data-schema-row]');try{const f=v23ReadRow(row);v23OptionEditor={row,f,units:f.type==='number_unit',options:v23Clone(v23Options(f,f.type==='number_unit'))};v23DrawOptions();v23Modal().showModal();}catch(e){if(/至少需要/.test(e.message)){const f=v23ReadRow(row,false);v23OptionEditor={row,f,units:f.type==='number_unit',options:v23Clone(v23Options(f,f.type==='number_unit'))};v23DrawOptions();v23Modal().showModal();}else alertV17(e.message,true);}}
function v23DrawOptions(){
    const s=v23OptionEditor;
    v23Modal().innerHTML=`<div class="v23-modal-head"><div><h2>管理${s.units?'單位':'選項'}－${v23Attr(s.f.label)}</h2><p>上到下是前端順序；停用可恢復，已寫入紀錄的名稱不變。</p></div><button onclick="v23Modal().close()" aria-label="關閉">✕</button></div><div id="v23-option-list">${s.options.map((o,i)=>`<div class="v23-option-row ${o.active?'':'v23-field-off'}"><span>${i+1}</span><input class="v17-input" data-option-index="${i}" value="${v23Attr(o.label)}" aria-label="選項名稱"><button onclick="v23MoveOption(${i},-1)" aria-label="選項上移">↑</button><button onclick="v23MoveOption(${i},1)" aria-label="選項下移">↓</button><button onclick="v23ToggleOption(${i})">${o.active?'停用':'恢復'}</button></div>`).join('')}</div><button class="v17-btn v17-btn-secondary" onclick="v23AddOption()">＋ 新增${s.units?'單位':'選項'}</button><div class="v17-actions"><button class="v17-btn v17-btn-secondary" onclick="v23Modal().close()">取消</button><button class="v17-btn v17-btn-primary" onclick="v23SaveOptions()">套用至卡片</button></div><p class="v17-section-note">套用後還需儲存管路卡片，才會更新資料庫。</p>`;
}
function v23CollectOptions(){document.querySelectorAll('[data-option-index]').forEach(el=>{v23OptionEditor.options[Number(el.dataset.optionIndex)].label=el.value.trim();});}
function v23MoveOption(i,dir){v23CollectOptions();const opts=v23OptionEditor.options,j=i+dir;if(j<0||j>=opts.length)return;[opts[i],opts[j]]=[opts[j],opts[i]];v23DrawOptions();}
function v23ToggleOption(i){v23CollectOptions();v23OptionEditor.options[i].active=!v23OptionEditor.options[i].active;v23DrawOptions();}
function v23AddOption(){v23CollectOptions();v23OptionEditor.options.push({id:v23Key(),value:'',label:'',active:true});v23DrawOptions();}
function v23SaveOptions(){
    v23CollectOptions();const s=v23OptionEditor;
    try {
        const options=s.options.map(o=>({...o,value:o.value||o.label}));
        if(options.some(o=>!o.label||!o.value))throw new Error('選項名稱不得空白');
        if(new Set(options.map(o=>o.value)).size!==options.length||new Set(options.filter(o=>o.active).map(o=>o.label)).size!==options.filter(o=>o.active).length)throw new Error('選項不可重複');
        if(!options.some(o=>o.active))throw new Error('至少保留一個啟用選項');
        if(s.f.value_type==='number'&&!s.units&&options.some(o=>o.active&&(!Number.isFinite(Number(o.value))||Number(o.value)<0||Number(o.label)!==Number(o.value))))throw new Error('數字選項只能包含有效的非負數字；修改尺寸請停用舊項並新增');
        s.f[s.units?'units':'options']=options;s.f.default=v23Default(s.f);s.row._field=s.f;v23DrawSchemaRow(s.row);v23Mark(s.row);v23Modal().close();
    }catch(e){alertV17(e.message,true);}
}
function v23PreviewTube(btn){try{const card=btn.closest('[data-v18-tube]'),fields=[...card.querySelectorAll('[data-schema-row]')].map(r=>v23ReadRow(r)).filter(f=>f.active!==false);v23Modal().innerHTML=`<div class="v23-modal-head"><div><h2>${v23Attr(card.querySelector('[id^="tube-name-"]').value)} 前端預覽</h2><p>顯示全院預設；各單位可另行覆寫。</p></div><button onclick="v23Modal().close()" aria-label="關閉">✕</button></div><div class="v23-preview-grid">${fields.map(f=>`<label>${v23Attr(f.label)}${f.unit&&f.unit!==f.label?'（'+v23Attr(f.unit)+'）':''}${v23Controls(f,v23Default(f),'v23-preview-'+f.key)}</label>`).join('')}</div><div class="v17-actions"><button class="v17-btn v17-btn-secondary" onclick="v23Modal().close()">關閉預覽</button></div>`;v23Modal().showModal();}catch(e){alertV17(e.message,true);}}
// Unit settings: inherit (live), override, or deliberately blank. Only own unit is writable by RLS.
renderHNTubeCard=function(t,s={}){
    const fields=v23Fields(t),defs=s.default_values||{},visible=s.is_visible!==false;
    const controls=fields.map(f=>{
        const has=Object.prototype.hasOwnProperty.call(defs,f.key),mode=!has?'inherit':defs[f.key]===null?'blank':'custom',val=v23Default(f,defs),global=v23Default(f);
        const invalid=has&&defs[f.key]!==null&&f.type==='select'&&!v23ChoiceValid(defs[f.key],v23Options(f));
        return `<div class="v23-hn-field" data-hn-field="${v23Attr(f.key)}"><label class="v17-label">${v23Attr(f.label)}${f.unit&&f.unit!==f.label?'（'+v23Attr(f.unit)+'）':''}</label><div class="v23-global-note">全院預設：${v23Attr(v23Describe(f,global))}</div>${invalid?'<div class="v23-invalid">原單位選項已停用，暫用有效的全院預設／空白，請重新選擇。</div>':''}<select class="v17-input" data-default-mode onchange="v23HNMode(this)"><option value="inherit" ${mode==='inherit'?'selected':''}>使用全院預設</option><option value="custom" ${mode==='custom'?'selected':''}>自訂單位預設</option><option value="blank" ${mode==='blank'?'selected':''}>不帶預設（空白）</option></select><div class="v23-hn-controls">${v23Controls(f,val,'hn-tube-def-'+t.id+'-'+f.key,mode==='custom'?'':'disabled')}</div></div>`;
    }).join('');
    return `<div class="v17-subcard ${visible?'':'v177-card-off'}" data-v177-tube="${v23Attr(t.id)}" data-dirty="0" data-v23-schema="${v23Attr(JSON.stringify(fields))}" data-v23-original-defaults="${v23Attr(JSON.stringify(defs))}"><div class="v17-status-line"><strong>${v23Attr(t.name)}</strong>${renderV17Toggle(`hn-tube-visible-${t.id}`,visible,'顯示',false,`onchange="v177ToggleCard(this,'tube','${t.id}')"`)}</div><label class="v23-check"><input data-sort-override type="checkbox" ${s.sort_override?'checked':''} onchange="this.closest('[data-v177-tube]').querySelector('[id^=hn-tube-sort]').disabled=!this.checked">自訂本單位排序（未勾選使用全院順位）</label><label class="v17-label mt-3">排序<input id="hn-tube-sort-${v23Attr(t.id)}" class="v17-input" type="number" min="0" step="1" value="${s.sort_override?(s.sort_order??t.sort_order??100):(t.sort_order??100)}" ${s.sort_override?'':'disabled'}></label>${controls}${visible?'':'<div class="v177-off-note">目前不在 CPR 畫面顯示</div>'}</div>`;
};
function v23HNMode(el){const field=el.closest('[data-hn-field]');field.querySelectorAll('.v23-hn-controls input,.v23-hn-controls select').forEach(c=>c.disabled=el.value!=='custom');v177SetDirty('tube',el.closest('[data-v177-tube]').dataset.v177Tube);}
saveAllHNTubes=async function(btn){
    const unit=getV17SettingsUnit();if(!unit||!(desktopProfile?.role==='head_nurse'||desktopProfile?.role==='admin'))return alertV17('找不到可設定的單位',true);
    const cards=[...document.querySelectorAll('[data-v177-tube][data-dirty="1"]')];if(!cards.length)return alertV17('管路設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');
    try {
        const payloads=cards.map(card=>{const id=card.dataset.v177Tube,fields=JSON.parse(card.dataset.v23Schema),defs=JSON.parse(card.dataset.v23OriginalDefaults||'{}');for(const f of fields){const block=card.querySelector(`[data-hn-field="${f.key}"]`),mode=block.querySelector('[data-default-mode]').value;if(mode==='inherit')delete defs[f.key];if(mode==='blank')defs[f.key]=null;if(mode==='custom')defs[f.key]=v23ReadControl(f,'hn-tube-def-'+id+'-'+f.key,card);}const sort=Number(document.getElementById('hn-tube-sort-'+id).value);if(!Number.isInteger(sort)||sort<0)throw new Error('排序請填非負整數');return {unit_id:unit.id,tube_type_id:id,is_visible:document.getElementById('hn-tube-visible-'+id).checked,sort_order:sort,sort_override:card.querySelector('[data-sort-override]').checked,default_values:defs};});
        const {error}=await supabaseClient.from('tube_unit_settings').upsert(payloads,{onConflict:'unit_id,tube_type_id'});if(error)throw error;
        cards.forEach((card,i)=>{card.dataset.dirty='0';card.dataset.v23OriginalDefaults=JSON.stringify(payloads[i].default_values)});v177RefreshDirtyBadge('tube');alertV17(`單位管路預設已更新，共 ${cards.length} 項`);
    }catch(e){alertV17(`儲存失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}
};
// Frontend controls, structured snapshots, and configuration loading.
renderDynamicTubeField=function(t,f){const label=`${f.label||f.key}${f.unit&&f.unit!==f.label?'（'+f.unit+'）':''}${f.required?' *':''}`;return `<label class="v23-clinical-field">${v23Attr(label)}${v23Controls(f,v23Default(f,t.default_values||{}),`dyn-tube-${t.code}-${f.key}`)}</label>`;};
submitDynamicTube=function(code){
    const t=(v17ClinicalConfig?.tubes||[]).find(t=>t.code===code);if(!t||caseLocked)return;
    try {
        const fields=v23Fields(t),snapshot=[],parts=[];
        for(const f of fields){const value=v23ReadControl(f,`dyn-tube-${code}-${f.key}`),empty=f.type==='number_unit'?value.value==='':value==='';
            if(f.required&&empty)throw new Error(`請填寫${f.label}`);if(empty)continue;
            const unit=f.type==='number_unit'?(v23Options(f,true).find(o=>o.value===String(value.unit))?.label??value.unit):(f.unit||'');
            const scalar=f.type==='number_unit'?value.value:value,label=f.type==='select'?(v23Options(f).find(o=>o.value===String(value))?.label??String(value)):String(scalar);
            snapshot.push({key:f.key,label:f.label,type:f.type,value:scalar,display_value:label,unit,unit_value:f.type==='number_unit'?value.unit:null});
            parts.push(`${f.label}: ${label}${unit?' '+unit:''}`);
        }
        if(!parts.length)throw new Error('請至少填寫一項管路資料');
        logEvent('管路',`[${t.name}] ${parts.join(', ')}`,{schema_version:23,tube:{id:t.id||null,code:t.code,name:t.name},fields:snapshot});
    }catch(e){showToast(e.message,true);}
};
const v23OriginalRenderTubes=renderV17Tubes;
renderV17Tubes=function(list){
    // Keep values the nurse has touched when explicitly refreshing during a CPR.
    const panels=document.getElementById('tube-panels-container'),drafts=new Map();
    panels?.querySelectorAll('[data-v23-touched="1"]').forEach(el=>drafts.set(el.id,el.value));
    const selected=document.querySelector('.tube-panel:not(.hidden)')?.id;
    v23OriginalRenderTubes(list.map(t=>({...t,fields:v23Fields(t)})));
    drafts.forEach((val,id)=>{const el=document.getElementById(id);if(el&&(!(el instanceof HTMLSelectElement)||[...el.options].some(o=>o.value===val))){el.value=val;el.dataset.v23Touched='1';}});
    if(selected&&document.getElementById(selected))switchTubeTab(selected.slice(6));
    panels?.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',()=>el.dataset.v23Touched='1');el.addEventListener('change',()=>el.dataset.v23Touched='1');});
};
let v23ConfigRequest=0;
async function v23FetchTubes(unitCode=deviceUnit){const {data,error}=await supabaseClient.rpc('get_unit_tube_config_v23',{p_unit_code:unitCode});if(error)throw error;if(!Array.isArray(data))throw new Error('管路設定格式不正確');return data;}
const v23OriginalClinicalLoad=loadV17ClinicalConfig;
loadV17ClinicalConfig=async function(unitCode=deviceUnit){
    const request=++v23ConfigRequest;
    // Fetch both independently, retain the original medication/rhythm/blood RPC.
    const [original,tubeResult]=await Promise.allSettled([supabaseClient.rpc('get_unit_clinical_config',{p_unit_code:unitCode}),v23FetchTubes(unitCode)]);
    if(request!==v23ConfigRequest||unitCode!==deviceUnit)return;
    if(original.status==='fulfilled'&&!original.value.error&&original.value.data){v17ClinicalConfig=original.value.data;}
    if(tubeResult.status==='fulfilled'){v17ClinicalConfig=v17ClinicalConfig||{};v17ClinicalConfig.tubes=tubeResult.value;}
    if(v17ClinicalConfig)applyV17ClinicalConfig();
    const err=tubeResult.status==='rejected'?tubeResult.reason:null;
    v23TubeStatus(err?'無法讀取最新管路設定，請檢查連線與 V2.3 SQL。':'');
};
function v23TubeStatus(message){let row=document.getElementById('v23-tube-status');if(!row){const tabs=document.getElementById('tube-tabs-container');if(!tabs)return;row=document.createElement('div');row.id='v23-tube-status';row.className='v23-tube-status';tabs.before(row);}row.innerHTML=`<span class="${message?'v23-invalid':''}">${v23Attr(message||'管路依本單位設定')}</span><button type="button" onclick="v23RefreshTubes(this)">更新管路設定</button>`;}
async function v23RefreshTubes(btn){if(!deviceUnit)return;btn.disabled=true;try{const unit=deviceUnit,request=++v23ConfigRequest,list=await v23FetchTubes(unit);if(unit!==deviceUnit||request!==v23ConfigRequest)return;v17ClinicalConfig=v17ClinicalConfig||{};v17ClinicalConfig.tubes=list;renderV17Tubes(list);v23TubeStatus('');}catch(e){v23TubeStatus('無法更新管路設定，請確認連線或先執行 V2.3 SQL。');}finally{btn.disabled=false;}}
const v23OriginalReset=resetForNewCPR;
resetForNewCPR=function(){v23OriginalReset();document.querySelectorAll('[data-v23-touched]').forEach(el=>delete el.dataset.v23Touched);if(v17ClinicalConfig)renderV17Tubes(v17ClinicalConfig.tubes||[]);if(deviceUnit)loadV17ClinicalConfig(deviceUnit);};
window.addEventListener('focus',()=>{if(deviceUnit&&!currentCprId)loadV17ClinicalConfig(deviceUnit);});
// V2.2's one-time boot may have run in desktop mode. Fetch configuration when
// the device enters mobile mode later, or changes/selects its unit.
const v23OriginalDeviceRegister=registerCloudDevice;
registerCloudDevice=async function(unitCode){
    const result=await v23OriginalDeviceRegister(unitCode);
    if(unitCode&&currentAppMode==='mobile')await loadV17ClinicalConfig(unitCode);
    return result;
};
const v23OriginalMobileReady=ensureMobileModeReady;
ensureMobileModeReady=async function(){
    const wasInitialized=v176MobileInitialized;
    await v23OriginalMobileReady();
    if(wasInitialized&&deviceUnit)await loadV17ClinicalConfig(deviceUnit);
};
