// CPRNOTE V2 - 正式上線版
const CPRNOTE_APP_VERSION = "2";
const CPRNOTE_RELEASE_DATE = "20260930";
const CPRNOTE_COPYRIGHT_OWNER = "MentoLi";

function applyCprNoteBranding(){
    const versionLabel = `V${CPRNOTE_APP_VERSION}`;
    const copyright = `Copyright © ${CPRNOTE_COPYRIGHT_OWNER} ${CPRNOTE_RELEASE_DATE}｜${versionLabel}`;
    document.querySelectorAll('[data-app-version]').forEach(el=>el.textContent=versionLabel);
    document.querySelectorAll('[data-app-copyright]').forEach(el=>el.textContent=copyright);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',applyCprNoteBranding); else applyCprNoteBranding();
// --- 全域變數 ---
        let isRunning = false;
        let isTotalTimerRunning = false;
        let totalSeconds = 0;
        let cprSeconds = 120; 
        let epiSeconds = 0;
        let cycleCount = 1;
        let timerInterval;
        let events = [];
        let systemStartTime = null;
        
        let audioCtx = null;
        let audioEnabled = true;

        let medSummaryDict = {};
        let givenMedSet = new Set(); 
        let currentFilter = '全部';
        
        let activeMedName = '';
        let activeMedQty = 1;
        let prepSol = 'N/S';
        let prepVol = '250';

        let bloodAction = '緊急輸血';
        let bloodProd = '';
        let bloodColorBg = 'bg-red-500';
        
        let activePulse = '';
        let selectedCycleRhythm = '';

        let cprAlarmInterval = null;
        let epiAlarmInterval = null;
        let wakeLock = null; // 螢幕防休眠 API 變數

        // --- V15 個案 / 裝置資訊 ---
        const V15_DEVICE_UNIT_KEY = 'cpr_v15_device_unit';
        const V15_DEVICE_ID_KEY = 'cpr_v15_device_id';
        const V15_ACTIVE_CASE_KEY = 'cpr_v15_active_case';
        const V15_ARCHIVED_CASES_KEY = 'cpr_v15_archived_cases';
        const V15_MAX_ACTIVE_MS = 8 * 60 * 60 * 1000;
        let deviceUnit = '';
        let deviceId = '';
        let currentCprId = '';
        let recordingDeviceId = '';
        let currentBed = '';
        let currentNurseId = '';
        let cprStartedAtMs = null;
        let cprEndedAtMs = null;
        let cprEndTime = '';
        let caseLocked = false;
        let roscRecorded = false;
        let actionToastLeftHandler = null;
        let actionToastRightHandler = null;
        let restorePromptShown = false;

        // --- 全域點擊喚醒 iOS 音效機制 ---
        document.addEventListener('click', function() {
            if (audioEnabled) {
                if (!audioCtx) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    audioCtx = new AudioContext();
                }
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
            }
        }, { capture: true, once: false });
        document.addEventListener('touchstart', function() {
            if (audioEnabled && audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        }, { capture: true, once: false });

        // --- 螢幕防休眠 (Screen Wake Lock API) ---
        async function requestWakeLock() {
            try {
                if ('wakeLock' in navigator) {
                    wakeLock = await navigator.wakeLock.request('screen');
                    wakeLock.addEventListener('release', () => {
                        console.log('Screen Wake Lock released');
                    });
                }
            } catch (err) {
                console.error(`${err.name}, ${err.message}`);
            }
        }
        function releaseWakeLock() {
            if (wakeLock !== null) {
                wakeLock.release();
                wakeLock = null;
            }
        }
        // 若切換視窗回來，如果計時器還在跑，重新索取防休眠
        document.addEventListener('visibilitychange', async () => {
            if (isRunning && wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        });


        // --- 藥物智能字典 ---
        const medDict = {
            'Adrenalin': { generic: 'Epinephrine', val: 1, unit: 'mg', ml: 1, quick: [] },
            'Adenocor': { generic: 'Adenosine', val: 6, unit: 'mg', ml: 2, quick: [1, 2] },
            'Atropine': { generic: 'Atropine', val: 1, unit: 'mg', ml: 1, quick: [0.5, 1] },
            'Cordarone': { generic: 'Amiodarone', val: 150, unit: 'mg', ml: 3, quick: [1, 2, 6] },
            'Dopamin': { generic: 'Dopamine', val: 200, unit: 'mg', ml: 5, quick: [2, 4] },
            'Dormicum': { generic: 'Midazolam', val: 5, unit: 'mg', ml: 1, quick: [0.5, 1] },
            'Fursemide': { generic: 'Furosemide', val: 20, unit: 'mg', ml: 2, quick: [] },
            'MgSO4': { generic: '10% Mag. Sulfate', val: 2, unit: 'g', ml: 20, quick: [] },
            'Norepinephrine': { generic: 'Norepinephrine', val: 4, unit: 'mg', ml: 4, quick: [2, 4] },
            'Rolikan': { generic: '7% Sodium Bicarbonate', val: 16.6, unit: 'mEq', ml: 20, quick: [5, 10] },
            'Vitacal': { generic: 'Calcium Chloride', val: 400, unit: 'mg', ml: 20, quick: [] },
            'Vitagen 50%': { generic: '50% Glucose', val: 10, unit: 'g', ml: 20, quick: [] }
        };

        const incompatMatrix = {
            'Rolikan': ['Adrenalin', 'Cordarone', 'Dopamin', 'Norepinephrine', 'Vitacal'],
            'Adrenalin': ['Rolikan'],
            'Cordarone': ['Rolikan'],
            'Dopamin': ['Rolikan'],
            'Norepinephrine': ['Rolikan'],
            'Vitacal': ['Rolikan']
        };

        function updateRealClock() {
            let now = new Date();
            document.getElementById('real-clock').innerText = now.toTimeString().substring(0,8);
        }
        updateRealClock();
        setInterval(updateRealClock, 1000);

        function getOrCreateDeviceId() {
            let saved = localStorage.getItem(V15_DEVICE_ID_KEY);
            if(saved) return saved;
            let id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `DEV-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
            localStorage.setItem(V15_DEVICE_ID_KEY, id);
            return id;
        }

        function createCprId() {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
            const rand = Math.random().toString(36).slice(2,6).toUpperCase();
            return `${deviceUnit}-${stamp}-${rand}`;
        }

        function formatDateTime(ms) {
            if(!ms) return '--';
            const d = new Date(ms);
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }

        function buildCaseSnapshot() {
            return {
                schemaVersion: 2,
                savedAtMs: Date.now(),
                deviceId,
                deviceUnit,
                currentCprId,
                recordingDeviceId,
                currentBed,
                currentNurseId,
                cprStartedAtMs,
                cprEndedAtMs,
                cprEndTime,
                caseLocked,
                roscRecorded,
                isRunning,
                isTotalTimerRunning,
                totalSeconds,
                cprSeconds,
                epiSeconds,
                cycleCount,
                systemStartTime,
                events,
                medSummaryDict,
                givenMedSet: Array.from(givenMedSet),
                totalStartTimeMs,
                pausedTotalElapsedMs,
                cprTargetTimeMs,
                epiTargetTimeMs
            };
        }

        function persistCurrentCase() {
            if(!currentCprId || caseLocked) return;
            try {
                localStorage.setItem(V15_ACTIVE_CASE_KEY, JSON.stringify(buildCaseSnapshot()));
            } catch(err) {
                console.error('儲存 CPR 本機狀態失敗', err);
            }
        }

        function clearStoredActiveCase() {
            localStorage.removeItem(V15_ACTIVE_CASE_KEY);
        }

        function getStoredActiveCase() {
            try {
                const raw = localStorage.getItem(V15_ACTIVE_CASE_KEY);
                if(!raw) return null;
                const data = JSON.parse(raw);
                if(!data || !data.currentCprId || data.deviceId !== deviceId) return null;
                return data;
            } catch(err) {
                console.error('讀取 CPR 本機狀態失敗', err);
                clearStoredActiveCase();
                return null;
            }
        }

        function archiveSnapshot(snapshot, reason) {
            if(!snapshot || !snapshot.currentCprId) return;
            try {
                const raw = localStorage.getItem(V15_ARCHIVED_CASES_KEY);
                let list = raw ? JSON.parse(raw) : [];
                if(!Array.isArray(list)) list = [];
                const already = list.some(x => x.currentCprId === snapshot.currentCprId);
                if(!already) {
                    list.unshift({
                        ...snapshot,
                        caseLocked: true,
                        archiveReason: reason,
                        archivedAtMs: Date.now()
                    });
                    // 測試版只保留最近 10 筆本機封存，正式版改存 Supabase
                    list = list.slice(0, 10);
                    localStorage.setItem(V15_ARCHIVED_CASES_KEY, JSON.stringify(list));
                }
            } catch(err) {
                console.error('封存 CPR 本機狀態失敗', err);
            }
        }

        function archiveCurrentCase(reason) {
            if(!currentCprId) return;
            archiveSnapshot(buildCaseSnapshot(), reason);
            clearStoredActiveCase();
        }

        function closeActionToast() {
            const box = document.getElementById('action-toast');
            box.classList.add('opacity-0');
            setTimeout(() => box.classList.add('hidden'), 180);
            actionToastLeftHandler = null;
            actionToastRightHandler = null;
        }

        function showActionToast({
            title = '提示',
            message = '',
            leftText = '取消',
            rightText = '確認',
            danger = false,
            leftAction = null,
            rightAction = null
        }) {
            const box = document.getElementById('action-toast');
            const wrap = document.getElementById('action-toast-icon-wrap');
            const icon = document.getElementById('action-toast-icon');
            const leftBtn = document.getElementById('action-toast-left');
            const rightBtn = document.getElementById('action-toast-right');

            document.getElementById('action-toast-title').innerText = title;
            document.getElementById('action-toast-msg').innerText = message;
            leftBtn.innerText = leftText;
            rightBtn.innerText = rightText;

            wrap.className = danger
                ? 'w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0 mt-0.5'
                : 'w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 mt-0.5';
            icon.className = danger ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info';
            rightBtn.className = danger
                ? 'flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold btn-active'
                : 'flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold btn-active';

            actionToastLeftHandler = leftAction;
            actionToastRightHandler = rightAction;

            leftBtn.onclick = () => {
                const fn = actionToastLeftHandler;
                closeActionToast();
                if(fn) fn();
            };
            rightBtn.onclick = () => {
                const fn = actionToastRightHandler;
                closeActionToast();
                if(fn) fn();
            };

            box.classList.remove('hidden');
            requestAnimationFrame(() => box.classList.remove('opacity-0'));
        }

        function checkStoredCaseOnLaunch() {
            if(restorePromptShown) return;
            const stored = getStoredActiveCase();
            if(!stored) return;

            const started = Number(stored.cprStartedAtMs || 0);
            if(!started || Date.now() - started >= V15_MAX_ACTIVE_MS) {
                archiveSnapshot(stored, '超過8小時未手動停止');
                clearStoredActiveCase();
                return;
            }

            restorePromptShown = true;
            showActionToast({
                title: '偵測到尚未結束的 CPR',
                message: `病房：${stored.deviceUnit || deviceUnit}\nCPR開始時間：${formatDateTime(started)}`,
                leftText: '開始新的 CPR',
                rightText: '恢復紀錄',
                leftAction: () => {
                    archiveSnapshot(stored, '建立新 CPR 時自動封存');
                    clearStoredActiveCase();
                    resetForNewCPR();
                    showToast('上一筆 CPR 已封存，可開始新的急救');
                },
                rightAction: () => restoreStoredCase(stored)
            });
        }

        function restoreStoredCase(data) {
            currentCprId = data.currentCprId || '';
            cloudCaseId = data.cloudCaseId || '';
            recordingDeviceId = deviceId;
            currentBed = data.currentBed || '';
            currentNurseId = data.currentNurseId || '';
            cprStartedAtMs = Number(data.cprStartedAtMs || Date.now());
            cprEndedAtMs = null;
            cprEndTime = '';
            caseLocked = false;
            roscRecorded = !!data.roscRecorded;
            isRunning = !!data.isRunning;
            isTotalTimerRunning = !!data.isTotalTimerRunning;
            totalSeconds = Number(data.totalSeconds || 0);
            cprSeconds = Number.isFinite(Number(data.cprSeconds)) ? Number(data.cprSeconds) : 120;
            epiSeconds = Number.isFinite(Number(data.epiSeconds)) ? Number(data.epiSeconds) : 0;
            cycleCount = Number(data.cycleCount || 1);
            systemStartTime = data.systemStartTime || new Date(cprStartedAtMs).toTimeString().substring(0,8);
            events = Array.isArray(data.events) ? data.events : [];
            medSummaryDict = data.medSummaryDict && typeof data.medSummaryDict === 'object' ? data.medSummaryDict : {};
            givenMedSet = new Set(Array.isArray(data.givenMedSet) ? data.givenMedSet : []);
            totalStartTimeMs = Number(data.totalStartTimeMs || 0);
            pausedTotalElapsedMs = Number(data.pausedTotalElapsedMs || 0);
            cprTargetTimeMs = Number(data.cprTargetTimeMs || 0);
            epiTargetTimeMs = Number(data.epiTargetTimeMs || 0);

            const now = Date.now();
            if(isRunning && totalStartTimeMs > 0) {
                totalSeconds = Math.max(0, Math.floor((now - totalStartTimeMs) / 1000));
            }
            document.getElementById('total-timer').innerText = formatTimeFull(totalSeconds);

            if(cprSeconds > 0 && cprTargetTimeMs > 0) {
                const remain = Math.ceil((cprTargetTimeMs - now) / 1000);
                if(remain <= 0) {
                    cprSeconds = -1;
                    cprTargetTimeMs = 0;
                    document.getElementById('cpr-timer').innerText = '00:00';
                } else {
                    cprSeconds = remain;
                    document.getElementById('cpr-timer').innerText = formatTimeMinSec(remain);
                }
            } else if(roscRecorded) {
                document.getElementById('cpr-timer').innerText = '--:--';
            } else if(cprSeconds === -1) {
                document.getElementById('cpr-timer').innerText = '00:00';
            } else {
                document.getElementById('cpr-timer').innerText = formatTimeMinSec(Math.max(0, cprSeconds));
            }

            const epiCount = Number(medSummaryDict['Adrenalin'] || 0);
            const countBadge = document.getElementById('epi-badge-count');
            const timerBadge = document.getElementById('epi-timer-badge');
            if(epiCount > 0) {
                countBadge.innerText = epiCount;
                countBadge.classList.remove('hidden');
            } else {
                countBadge.classList.add('hidden');
            }

            if(epiSeconds > 0 && epiTargetTimeMs > 0) {
                const remain = Math.ceil((epiTargetTimeMs - now) / 1000);
                timerBadge.classList.remove('hidden', 'bg-red-800', 'bg-slate-500');
                timerBadge.classList.add('bg-red-600');
                if(remain <= 0) {
                    epiSeconds = -1;
                    epiTargetTimeMs = 0;
                    timerBadge.innerText = '超時!';
                    timerBadge.classList.remove('bg-red-600');
                    timerBadge.classList.add('bg-red-800');
                } else {
                    epiSeconds = remain;
                    timerBadge.innerText = formatTimeMinSec(remain);
                    if(remain <= 30) timerBadge.classList.add('timer-warning');
                }
            } else if(epiSeconds === -1) {
                timerBadge.classList.remove('hidden', 'bg-red-600', 'bg-slate-500', 'timer-warning');
                timerBadge.classList.add('bg-red-800');
                timerBadge.innerText = '超時!';
            } else if(epiSeconds === -2) {
                timerBadge.classList.remove('hidden', 'bg-red-600', 'bg-red-800', 'timer-warning');
                timerBadge.classList.add('bg-slate-500');
                timerBadge.innerText = '暫停';
            } else {
                timerBadge.classList.add('hidden');
            }

            const panel = document.getElementById('view-actions');
            const btnStart = document.getElementById('btn-start');
            const btnRosc = document.getElementById('btn-rosc');
            if(isRunning) {
                panel.classList.remove('opacity-50', 'pointer-events-none', 'case-locked');
                btnStart.innerHTML = '<i class="fa-solid fa-pause"></i> 暫停計時';
                btnStart.className = 'flex-1 bg-yellow-500 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';
                btnRosc.classList.remove('opacity-50', 'pointer-events-none');
                requestWakeLock();
                startRestoredTimerLoop();
            } else if(roscRecorded) {
                panel.classList.remove('opacity-50', 'pointer-events-none', 'case-locked');
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 繼續計時';
                btnStart.className = 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';
                btnRosc.classList.add('opacity-50', 'pointer-events-none');
            } else {
                panel.classList.add('opacity-50', 'pointer-events-none');
                panel.classList.remove('case-locked');
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 繼續計時';
                btnStart.className = 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';
                btnRosc.classList.add('opacity-50', 'pointer-events-none');
            }

            if(cprSeconds === -1 && isRunning) startCprAlarm();
            if(epiSeconds === -1 && isRunning) startEpiAlarm();

            updateCaseInfoBar();
            renderTimeline();
            persistCurrentCase();
            showToast('已恢復尚未結束的 CPR 紀錄');
        }

        function startRestoredTimerLoop() {
            clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                const currentNow = Date.now();
                if(isTotalTimerRunning && totalStartTimeMs > 0) {
                    totalSeconds = Math.floor((currentNow - totalStartTimeMs) / 1000);
                    document.getElementById('total-timer').innerText = formatTimeFull(totalSeconds);
                }
                if(cprSeconds !== -1 && cprTargetTimeMs > 0) {
                    const remain = Math.ceil((cprTargetTimeMs - currentNow) / 1000);
                    if(remain <= 0) {
                        showToast('⚠️ 2分鐘循環時間到', true, 3000);
                        startCprAlarm();
                        cprSeconds = -1;
                        cprTargetTimeMs = 0;
                        document.getElementById('cpr-timer').innerText = '00:00';
                    } else {
                        cprSeconds = remain;
                        document.getElementById('cpr-timer').innerText = formatTimeMinSec(remain);
                    }
                }
                if(epiSeconds !== -1 && epiSeconds !== -2 && epiTargetTimeMs > 0) {
                    const remain = Math.ceil((epiTargetTimeMs - currentNow) / 1000);
                    if(remain <= 30 && remain > 0) document.getElementById('epi-timer-badge').classList.add('timer-warning');
                    if(remain <= 0) {
                        showToast('⚠️ Adrenalin 3分鐘已到！', true, 3000);
                        startEpiAlarm();
                        const badge = document.getElementById('epi-timer-badge');
                        badge.classList.remove('timer-warning', 'bg-red-600', 'bg-slate-500');
                        badge.classList.add('bg-red-800');
                        badge.innerText = '超時!';
                        epiSeconds = -1;
                        epiTargetTimeMs = 0;
                    } else {
                        epiSeconds = remain;
                        document.getElementById('epi-timer-badge').innerText = formatTimeMinSec(remain);
                    }
                }
                updateTimelineMiniStatus();
            }, 200);
        }

        function autoArchiveIfExpired() {
            if(!currentCprId || caseLocked || !cprStartedAtMs) return;
            if(Date.now() - cprStartedAtMs < V15_MAX_ACTIVE_MS) return;

            isRunning = false;
            isTotalTimerRunning = false;
            clearInterval(timerInterval);
            stopCprAlarm();
            stopEpiAlarm();
            releaseWakeLock();
            archiveCurrentCase('超過8小時未手動停止');
            resetForNewCPR();
            showToast('前一筆 CPR 已超過8小時，系統已自動封存');
        }

        function initV15() {
            deviceId = getOrCreateDeviceId();
            const savedUnit = localStorage.getItem(V15_DEVICE_UNIT_KEY);
            if(savedUnit) {
                deviceUnit = savedUnit;
                updateCaseInfoBar();
                setTimeout(checkStoredCaseOnLaunch, 180);
            } else {
                deviceUnit = '';
                updateCaseInfoBar();
                setTimeout(checkStoredCaseOnLaunch, 180);
            }
        }

        function confirmDeviceUnit() {
            const unit = document.getElementById('device-unit-select').value;
            if(!unit) return showToast('請選擇使用單位', true);
            deviceUnit = unit;
            localStorage.setItem(V15_DEVICE_UNIT_KEY, unit);
            updateCaseInfoBar();
            closeModal();
            showToast(`此裝置已設定為 ${unit}`);
            setTimeout(checkStoredCaseOnLaunch, 250);
        }

        function updateCaseInfoBar() {
            document.getElementById('case-unit').innerText = deviceUnit || '單位未設定';
            document.getElementById('case-info-unit').innerText = deviceUnit || '單位未設定';

            if(!currentCprId) {
                document.getElementById('case-bed').innerText = '尚未開始';
                document.getElementById('case-nurse').innerText = '員編待補';
                document.getElementById('case-id-label').innerText = '尚未建立 CPR 個案';
            } else {
                document.getElementById('case-bed').innerText = currentBed ? `${currentBed}床` : '床號待補';
                document.getElementById('case-nurse').innerText = currentNurseId ? `員編 ${currentNurseId}` : '員編待補';
                document.getElementById('case-id-label').innerText = caseLocked ? `已封存｜${currentCprId}` : `CPR｜${currentCprId}`;
            }

            const infoBtn = document.getElementById('btn-case-info');
            const stopBtn = document.getElementById('btn-stop-cpr');
            const canEdit = canEditCurrentCase();
            setButtonEnabled(infoBtn, canEdit);
            setButtonEnabled(stopBtn, canEdit);

            if(caseLocked) {
                document.getElementById('local-status').innerHTML = '<i class="fa-solid fa-lock text-[8px]"></i> 已封存';
                document.getElementById('local-status').className = 'hidden text-emerald-300';
            } else {
                document.getElementById('local-status').innerHTML = '<i class="fa-solid fa-circle text-[6px]"></i> V15.2 本機測試';
                document.getElementById('local-status').className = 'hidden text-amber-300';
            }
            updateTimelineMiniStatus();
        }

        function updateTimelineMiniStatus() {
            const unitEl = document.getElementById('timeline-unit');
            if(!unitEl) return;

            document.getElementById('timeline-unit').innerText = deviceUnit || '單位未設定';
            document.getElementById('timeline-bed').innerText = currentCprId
                ? (currentBed ? `${currentBed}床` : '床號待補')
                : '尚未開始';
            document.getElementById('timeline-total').innerText = document.getElementById('total-timer').innerText;

            const epiWrap = document.getElementById('timeline-epi-wrap');
            const epiText = document.getElementById('timeline-epi');
            if(epiSeconds === 0) {
                epiWrap.classList.add('hidden');
                epiWrap.classList.remove('flex');
            } else {
                epiWrap.classList.remove('hidden');
                epiWrap.classList.add('flex');
                if(epiSeconds > 0) epiText.innerText = formatTimeMinSec(epiSeconds);
                else if(epiSeconds === -1) epiText.innerText = '超時';
                else if(epiSeconds === -2) epiText.innerText = '暫停';
                else epiText.innerText = '--:--';
            }
        }

        function setButtonEnabled(btn, enabled) {
            if(enabled) {
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            } else {
                btn.disabled = true;
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            }
        }

        function canEditCurrentCase() {
            return !!currentCprId && !caseLocked && recordingDeviceId === deviceId;
        }

        function ensureCaseCreated() {
            if(currentCprId) return;
            currentCprId = createCprId();
            recordingDeviceId = deviceId;
            cprStartedAtMs = Date.now();
            currentBed = '';
            currentNurseId = '';
            caseLocked = false;
            roscRecorded = false;
            updateCaseInfoBar();
            persistCurrentCase();
        }

        function openCaseInfoModal() {
            if(!canEditCurrentCase()) return;
            document.getElementById('case-info-unit').innerText = deviceUnit || '單位未設定';
            document.getElementById('case-bed-input').value = currentBed;
            document.getElementById('case-nurse-input').value = currentNurseId;
            showModal('modal-case-info');
        }

        function saveCaseInfo() {
            if(!canEditCurrentCase()) return closeModal();
            currentBed = document.getElementById('case-bed-input').value.trim();
            currentNurseId = document.getElementById('case-nurse-input').value.trim();
            updateCaseInfoBar();
            persistCurrentCase();
            closeModal();
            showToast('本次 CPR 資料已更新');
        }

        function openStopModal() {
            if(!canEditCurrentCase()) return;
            const endNow = new Date();
            document.getElementById('stop-unit').innerText = deviceUnit || '單位未設定';
            document.getElementById('stop-case-id').innerText = currentCprId;
            document.getElementById('stop-bed-input').value = currentBed;
            document.getElementById('stop-nurse-input').value = currentNurseId;
            document.getElementById('stop-start-time').innerText = systemStartTime || '--:--:--';
            document.getElementById('stop-end-time').innerText = endNow.toTimeString().substring(0,8);
            document.getElementById('stop-total-time').innerText = document.getElementById('total-timer').innerText;
            showModal('modal-stop');
        }

        function confirmStopCPR() {
            if(!canEditCurrentCase()) return;
            const bed = document.getElementById('stop-bed-input').value.trim();
            const nurse = document.getElementById('stop-nurse-input').value.trim();
            if(!bed) return showToast('請輸入床號', true);
            if(!nurse) return showToast('請輸入紀錄護理師員編', true);

            currentBed = bed;
            currentNurseId = nurse;
            cprEndedAtMs = Date.now();
            cprEndTime = new Date(cprEndedAtMs).toTimeString().substring(0,8);

            logEvent('系統', `⛔ 停止急救｜${deviceUnit} ${currentBed}床｜紀錄護理師員編 ${currentNurseId}`);

            isRunning = false;
            isTotalTimerRunning = false;
            clearInterval(timerInterval);
            stopCprAlarm();
            stopEpiAlarm();
            releaseWakeLock();
            cprTargetTimeMs = 0;
            epiTargetTimeMs = 0;
            caseLocked = true;
            archiveCurrentCase('手動停止急救');

            const btnStart = document.getElementById('btn-start');
            btnStart.innerHTML = '<i class="fa-solid fa-plus"></i> 開始新的 CPR';
            btnStart.className = 'flex-1 bg-slate-700 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';
            const btnRosc = document.getElementById('btn-rosc');
            btnRosc.classList.add('opacity-50', 'pointer-events-none');
            const panel = document.getElementById('view-actions');
            panel.classList.add('opacity-50', 'pointer-events-none', 'case-locked');

            closeModal();
            updateCaseInfoBar();
            renderTimeline();
            showToast('本次 CPR 已停止並封存');
        }

        function resetForNewCPR() {
            clearStoredActiveCase();
            closeActionToast();
            isRunning = false;
            isTotalTimerRunning = false;
            totalSeconds = 0;
            cprSeconds = 120;
            epiSeconds = 0;
            cycleCount = 1;
            clearInterval(timerInterval);
            stopCprAlarm();
            stopEpiAlarm();
            releaseWakeLock();
            events = [];
            systemStartTime = null;
            medSummaryDict = {};
            givenMedSet = new Set();
            currentFilter = '全部';
            currentCprId = '';
            cloudCaseId = '';
            recordingDeviceId = '';
            currentBed = '';
            currentNurseId = '';
            cprStartedAtMs = null;
            cprEndedAtMs = null;
            cprEndTime = '';
            caseLocked = false;
            roscRecorded = false;
            totalStartTimeMs = 0;
            pausedTotalElapsedMs = 0;
            cprTargetTimeMs = 0;
            epiTargetTimeMs = 0;

            document.getElementById('total-timer').innerText = '00:00:00';
            document.getElementById('cpr-timer').innerText = '02:00';
            document.getElementById('epi-badge-count').classList.add('hidden');
            document.getElementById('epi-timer-badge').classList.add('hidden');
            document.getElementById('epi-badge-count').innerText = '0';

            const btnStart = document.getElementById('btn-start');
            btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 開始計時';
            btnStart.className = 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';
            const btnRosc = document.getElementById('btn-rosc');
            btnRosc.classList.add('opacity-50', 'pointer-events-none');
            const panel = document.getElementById('view-actions');
            panel.classList.add('opacity-50', 'pointer-events-none');
            panel.classList.remove('case-locked');
            renderTimeline();
            updateCaseInfoBar();
            switchMainTab('actions');
        }


        function formatTimeMinSec(sec) {
            let m = Math.floor(sec / 60).toString().padStart(2, '0');
            let s = (sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }
        function formatTimeFull(sec) {
            let h = Math.floor(sec / 3600).toString().padStart(2, '0');
            let m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
            let s = (sec % 60).toString().padStart(2, '0');
            return `${h}:${m}:${s}`;
        }
        function formatDose(val) {
            return Number.isInteger(val) ? val : parseFloat(val.toFixed(1));
        }

        // --- 無限循環警報音 ---
        function startCprAlarm() {
            if(cprAlarmInterval) return;
            if(audioEnabled) playCycleBeep();
            cprAlarmInterval = setInterval(() => { if(audioEnabled) playCycleBeep(); }, 3000);
        }
        function stopCprAlarm() {
            if(cprAlarmInterval) clearInterval(cprAlarmInterval);
            cprAlarmInterval = null;
        }

        function startEpiAlarm() {
            if(epiAlarmInterval) return;
            if(audioEnabled) playSharpBeep(3);
            epiAlarmInterval = setInterval(() => { if(audioEnabled) playSharpBeep(3); }, 3000);
        }
        function stopEpiAlarm() {
            if(epiAlarmInterval) clearInterval(epiAlarmInterval);
            epiAlarmInterval = null;
        }

        // --- 核心計時 (含絕對時間校準架構) ---
        let totalStartTimeMs = 0;
        let pausedTotalElapsedMs = 0;
        let cprTargetTimeMs = 0;
        let epiTargetTimeMs = 0;

        function toggleCPR() {
            if(!deviceUnit) { showToast('請先從右上角 ⚙ 裝置設定選擇使用單位', true); openDeviceDrawer(); document.getElementById('drawer-unit-editor')?.classList.remove('hidden'); return; }
            let btnStart = document.getElementById('btn-start');
            let panel = document.getElementById('view-actions');
            let btnRosc = document.getElementById('btn-rosc');

            if(caseLocked) {
                resetForNewCPR();
                setTimeout(() => toggleCPR(), 0);
                return;
            }

            if (!audioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AudioContext();
            }
            if (audioCtx.state === 'suspended') audioCtx.resume();

            if (!isRunning) {
                ensureCaseCreated();
                if(!systemStartTime) systemStartTime = document.getElementById('real-clock').innerText;

                // ROSC 後若再次啟動 CPR，重新開始 2 分鐘循環
                if(roscRecorded) {
                    roscRecorded = false;
                    cprSeconds = 120;
                    document.getElementById('cpr-timer').innerText = '02:00';
                    logEvent('系統', 'ROSC 後重新啟動急救計時');
                }

                isRunning = true;
                isTotalTimerRunning = true;
                requestWakeLock();

                panel.classList.remove('opacity-50', 'pointer-events-none', 'case-locked');
                btnRosc.classList.remove('opacity-50', 'pointer-events-none');

                btnStart.innerHTML = '<i class="fa-solid fa-pause"></i> 暫停計時';
                btnStart.className = 'flex-1 bg-yellow-500 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';

                if(events.length === 0 || events[events.length - 1]?.detail !== 'ROSC 後重新啟動急救計時') {
                    logEvent('系統', '啟動/繼續急救計時');
                }

                let now = Date.now();
                totalStartTimeMs = now - pausedTotalElapsedMs;

                if (cprSeconds > 0) cprTargetTimeMs = now + (cprSeconds * 1000);
                if (epiSeconds > 0) epiTargetTimeMs = now + (epiSeconds * 1000);

                if(cprSeconds === -1) startCprAlarm();
                if(epiSeconds === -1) startEpiAlarm();

                clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    let currentNow = Date.now();

                    if(isTotalTimerRunning) {
                        totalSeconds = Math.floor((currentNow - totalStartTimeMs) / 1000);
                        document.getElementById('total-timer').innerText = formatTimeFull(totalSeconds);
                    }

                    if (cprSeconds !== -1 && cprTargetTimeMs > 0) {
                        let remain = Math.ceil((cprTargetTimeMs - currentNow) / 1000);
                        if (remain <= 0) {
                            showToast('⚠️ 2分鐘循環時間到', true, 3000);
                            startCprAlarm();
                            cprSeconds = -1;
                            cprTargetTimeMs = 0;
                            document.getElementById('cpr-timer').innerText = '00:00';
                        } else {
                            cprSeconds = remain;
                            document.getElementById('cpr-timer').innerText = formatTimeMinSec(remain);
                        }
                    }

                    if (epiSeconds !== -1 && epiSeconds !== -2 && epiTargetTimeMs > 0) {
                        let remain = Math.ceil((epiTargetTimeMs - currentNow) / 1000);
                        if (remain <= 30 && remain > 0) {
                            document.getElementById('epi-timer-badge').classList.add('timer-warning');
                        }

                        if (remain <= 0) {
                            showToast('⚠️ Adrenalin 3分鐘已到！', true, 3000);
                            startEpiAlarm();
                            let badge = document.getElementById('epi-timer-badge');
                            badge.classList.remove('timer-warning');
                            badge.classList.add('bg-red-800');
                            badge.innerText = '超時!';
                            epiSeconds = -1;
                            epiTargetTimeMs = 0;
                        } else {
                            epiSeconds = remain;
                            document.getElementById('epi-timer-badge').innerText = formatTimeMinSec(remain);
                        }
                    }
                    updateTimelineMiniStatus();
                }, 200);
            } else {
                isRunning = false;
                isTotalTimerRunning = false;
                releaseWakeLock();

                let now = Date.now();
                pausedTotalElapsedMs = now - totalStartTimeMs;

                panel.classList.add('opacity-50', 'pointer-events-none');
                btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 繼續計時';
                btnStart.className = 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';

                clearInterval(timerInterval);
                stopCprAlarm();
                stopEpiAlarm();
            }
            persistCurrentCase();
            updateCaseInfoBar();
            updateTimelineMiniStatus();
        }

        function logROSC() {
            if(caseLocked || !currentCprId) return;
            if(roscRecorded) return showToast('ROSC 已經紀錄');

            logEvent('系統', '★★ 達成 ROSC ★★');
            roscRecorded = true;

            if(isRunning) {
                pausedTotalElapsedMs = Date.now() - totalStartTimeMs;
                totalSeconds = Math.floor(pausedTotalElapsedMs / 1000);
                document.getElementById('total-timer').innerText = formatTimeFull(totalSeconds);
            }

            isRunning = false;
            isTotalTimerRunning = false;
            clearInterval(timerInterval);

            cprSeconds = -1;
            cprTargetTimeMs = 0;
            document.getElementById('cpr-timer').innerText = '--:--';

            stopCprAlarm();
            stopEpiAlarm();
            releaseWakeLock();

            if(epiSeconds > 0 || epiSeconds === -1) {
                epiSeconds = -2;
                epiTargetTimeMs = 0;
                let badge = document.getElementById('epi-timer-badge');
                badge.innerText = '暫停';
                badge.classList.remove('timer-warning', 'bg-red-800');
                badge.classList.remove('bg-red-600');
                badge.classList.add('bg-slate-500');
            }

            // ROSC 只停計時，不封存：後續處置仍可繼續紀錄
            const panel = document.getElementById('view-actions');
            panel.classList.remove('opacity-50', 'pointer-events-none');
            const btnStart = document.getElementById('btn-start');
            btnStart.innerHTML = '<i class="fa-solid fa-play"></i> 繼續計時';
            btnStart.className = 'flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm btn-active shadow-sm flex justify-center items-center gap-1';
            document.getElementById('btn-rosc').classList.add('opacity-50', 'pointer-events-none');

            persistCurrentCase();
            showToast('已紀錄 ROSC；計時已停止，可繼續紀錄後續處置');
            updateCaseInfoBar();
            updateTimelineMiniStatus();
        }

        function logCode999() {
            if(caseLocked) return;
            if(!currentCprId) ensureCaseCreated();
            logEvent('系統', '🚨 啟動 999 呼叫');
            showToast('🚨 已啟動 999', true);
            if(!isRunning) toggleCPR();
        }

        // --- 音效處理 ---
        function toggleSound() {
            audioEnabled = !audioEnabled;
            let icon = document.getElementById('btn-sound');
            if(audioEnabled) {
                icon.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
                icon.classList.remove('text-red-400');
                showToast("提示音已開啟");
            } else {
                icon.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
                icon.classList.add('text-red-400');
                showToast("提示音已靜音");
                stopCprAlarm();
                stopEpiAlarm();
            }
        }
        
        function playSharpBeep(times) {
            if(!audioCtx || !audioEnabled) return;
            if(audioCtx.state === 'suspended') audioCtx.resume();
            
            let now = audioCtx.currentTime;
            for (let i = 0; i < times; i++) {
                let osc = audioCtx.createOscillator();
                let gain = audioCtx.createGain();
                osc.type = 'square'; 
                osc.frequency.value = 1000; 
                gain.gain.value = 0.2; 
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now + (i * 0.3));
                osc.stop(now + (i * 0.3) + 0.15);
            }
        }
        function playCycleBeep() {
            if(!audioCtx || !audioEnabled) return;
            if(audioCtx.state === 'suspended') audioCtx.resume();
            
            let now = audioCtx.currentTime;
            for (let i = 0; i < 2; i++) {
                let osc = audioCtx.createOscillator();
                let gain = audioCtx.createGain();
                osc.type = 'sine'; 
                osc.frequency.value = 500; 
                gain.gain.value = 0.5; 
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now + (i * 0.6));
                osc.stop(now + (i * 0.6) + 0.4);
            }
        }

        // --- 藥物處理 ---
        function checkIncompat(medName) {
            if(!incompatMatrix[medName]) return [];
            let conflicts = [];
            incompatMatrix[medName].forEach(incompatMed => {
                if(givenMedSet.has(incompatMed)) conflicts.push(incompatMed);
            });
            return conflicts;
        }

        function updateMedSummary(name, qty) {
            if(!medSummaryDict[name]) medSummaryDict[name] = 0;
            medSummaryDict[name] += qty;
        }

        function giveEpi() {
            openMedModal('Adrenalin');
        }

        function openMedModal(name) {
            activeMedName = name;
            activeMedQty = 1;
            prepSol = 'N/S';
            prepVol = '250';
            
            document.getElementById('med-modal-title').innerText = name;
            let genericEl = document.getElementById('med-modal-generic');
            let calcPanel = document.getElementById('med-calc-panel');
            
            let info = medDict[name];
            if(info) {
                genericEl.innerText = info.generic;
                genericEl.classList.remove('hidden');
                calcPanel.classList.remove('hidden');
                document.getElementById('med-modal-base').innerText = `1 支 = ${info.val} ${info.unit} / ${info.ml} ml`;
            } else {
                genericEl.classList.add('hidden');
                calcPanel.classList.add('hidden');
            }

            let unitLabel = document.getElementById('med-modal-unit');
            unitLabel.innerText = name.includes('500ml') ? '瓶' : '支';

            let conflicts = checkIncompat(name);
            let warnBox = document.getElementById('med-incompat-warning');
            if(conflicts.length > 0) {
                warnBox.classList.remove('hidden');
                document.getElementById('med-incompat-list').innerText = conflicts.join(', ');
            } else {
                warnBox.classList.add('hidden');
            }

            let quickContainer = document.getElementById('quick-qty-container');
            quickContainer.innerHTML = '';
            if(info && info.quick.length > 0) {
                info.quick.forEach(num => {
                    let btn = document.createElement('button');
                    btn.className = "px-6 py-2 bg-slate-100 text-slate-700 font-bold text-lg rounded-lg border border-slate-300 btn-active shadow-sm";
                    btn.innerText = num;
                    btn.onclick = () => { activeMedQty = num; refreshMedUI(); };
                    quickContainer.appendChild(btn);
                });
            }

            updatePrepUI();
            refreshMedUI();
            showModal('modal-med');
        }

        function adjMedQty(val) {
            if(activeMedQty + val > 0 && activeMedQty + val < 20) {
                activeMedQty += val;
                refreshMedUI();
            }
        }

        function refreshMedUI() {
            document.getElementById('med-modal-qty').innerText = activeMedQty;
            
            let info = medDict[activeMedName];
            if(info) {
                let calcVal = formatDose(info.val * activeMedQty);
                let calcMl = formatDose(info.ml * activeMedQty);
                document.getElementById('med-modal-total').innerText = `總計: ${calcVal} ${info.unit} / ${calcMl} ml`;
            }

            let prepContainer = document.getElementById('med-prep-container');
            let needPrep = (activeMedName === 'Norepinephrine' || activeMedName.includes('Dopamin') || (activeMedName.includes('Cordarone') && activeMedQty >= 6));
            
            if(needPrep) {
                prepContainer.classList.remove('hidden');
                prepContainer.classList.add('flex');
            } else {
                prepContainer.classList.add('hidden');
                prepContainer.classList.remove('flex');
            }
        }

        function setPrepSol(sol) { prepSol = sol; updatePrepUI(); }
        function setPrepVol(vol) { prepVol = vol; updatePrepUI(); }

        function updatePrepUI() {
            let actCls = "flex-1 py-3 rounded-lg text-base font-bold bg-blue-100 text-blue-700 border-2 border-blue-400 shadow-sm transition-all";
            let inactCls = "flex-1 py-3 rounded-lg text-base font-bold bg-white text-slate-500 border-2 border-slate-200 shadow-sm transition-all";
            
            document.getElementById('btn-sol-NS').className = prepSol === 'N/S' ? actCls : inactCls;
            document.getElementById('btn-sol-D5W').className = prepSol === 'D5W' ? actCls : inactCls;
            
            document.getElementById('btn-vol-250').className = prepVol === '250' ? actCls : inactCls;
            document.getElementById('btn-vol-500').className = prepVol === '500' ? actCls : inactCls;
        }

        function confirmMed() {
            let type = activeMedName.includes('大量點滴') ? '大量點滴' : '給藥';
            let unit = activeMedName.includes('500ml') ? '瓶' : '支';
            let detail = `${activeMedName} x ${activeMedQty} ${unit}`;
            
            let info = medDict[activeMedName];
            if(info) {
                let calcVal = formatDose(info.val * activeMedQty);
                let calcMl = formatDose(info.ml * activeMedQty);
                detail += ` (${calcVal}${info.unit}/${calcMl}ml)`;
            }

            let needPrep = (activeMedName === 'Norepinephrine' || activeMedName.includes('Dopamin') || (activeMedName.includes('Cordarone') && activeMedQty >= 6));
            if(needPrep) {
                let pr = document.getElementById('med-pump-run').value;
                detail += ` (加至 ${prepSol} ${prepVol}mL, Pump run: ${pr} 滴/分)`;
            }
            
            if(activeMedName.includes('Adrenalin')) {
                updateMedSummary(activeMedName, activeMedQty);
                let count = medSummaryDict[activeMedName];
                
                stopEpiAlarm(); // 停止持續警報並重設
                epiSeconds = 180; 
                epiTargetTimeMs = Date.now() + 180000; // 重置絕對時間
                
                let countBadge = document.getElementById('epi-badge-count');
                let timerBadge = document.getElementById('epi-timer-badge');
                countBadge.innerText = count;
                countBadge.classList.remove('hidden');
                timerBadge.innerText = "03:00";
                timerBadge.classList.remove('hidden', 'bg-red-800', 'bg-slate-500', 'timer-warning');
                timerBadge.classList.add('bg-red-600');
            } else {
                updateMedSummary(activeMedName, activeMedQty);
            }

            let conflicts = checkIncompat(activeMedName);
            givenMedSet.add(activeMedName);
            
            let event = { id: Date.now(), time: document.getElementById('real-clock').innerText, action: type, detail: detail };
            events.push(event);
            persistCurrentCase();
            renderTimeline();
            
            if(conflicts.length > 0) {
                setTimeout(() => { 
                    showToast(`⚠️ 注意：與 ${conflicts.join(', ')} 不相容<br><span class="text-[13px] text-red-200 mt-1 block">請建立另一條 IV Set (分開給藥)</span>`, true, 5000); 
                }, 100);
            } else {
                showToast(`${type}已紀錄`);
            }
            
            closeModal();
        }

        // --- 輸血/備血 ---
        function setBloodType(type) {
            bloodAction = type;
            let btnE = document.getElementById('btn-b-type-緊急輸血');
            let btnB = document.getElementById('btn-b-type-輸血');
            let btnP = document.getElementById('btn-b-type-備血');
            
            btnE.className = "flex-1 py-3 text-sm font-bold rounded-lg bg-white text-red-600 border-2 border-red-200 shadow-sm transition-colors";
            btnB.className = "flex-1 py-3 text-sm font-bold rounded-lg bg-white text-orange-600 border-2 border-orange-200 shadow-sm transition-colors";
            btnP.className = "flex-1 py-3 text-sm font-bold rounded-lg bg-white text-blue-600 border-2 border-blue-200 shadow-sm transition-colors";

            if(type === '緊急輸血') {
                btnE.classList.replace('bg-white', 'bg-red-500');
                btnE.classList.replace('text-red-600', 'text-white');
                bloodColorBg = 'bg-red-500';
            }
            if(type === '輸血') {
                btnB.classList.replace('bg-white', 'bg-orange-500');
                btnB.classList.replace('text-orange-600', 'text-white');
                bloodColorBg = 'bg-orange-500';
            }
            if(type === '備血') {
                btnP.classList.replace('bg-white', 'bg-blue-600');
                btnP.classList.replace('text-blue-600', 'text-white');
                bloodColorBg = 'bg-blue-600';
            }

            if(bloodProd) setBloodProd(bloodProd);
            document.getElementById('btn-submit-blood').className = `flex-1 ${bloodColorBg} text-white h-[46px] rounded-lg font-bold text-sm md:text-base btn-active shadow-sm transition-colors`;
        }

        function setBloodProd(prod) {
            bloodProd = prod;
            document.querySelectorAll('.blood-prod').forEach(el => {
                el.className = "blood-prod border-2 border-slate-200 py-3 rounded-lg text-sm font-bold bg-white text-slate-700 btn-active transition-colors";
            });
            let act = document.getElementById('btn-b-' + prod);
            act.className = `blood-prod border-2 py-3 rounded-lg text-sm font-bold ${bloodColorBg} text-white btn-active transition-colors border-transparent`;
        }

        function submitBlood() {
            if(!bloodProd) return showToast('請先選擇血品', true);
            let u = document.getElementById('val-blood-u').value;
            logEvent('血品', `[${bloodAction}] ${bloodProd} ${u}U`);
            bloodProd = '';
            document.querySelectorAll('.blood-prod').forEach(el => { 
                el.className = "blood-prod border-2 border-slate-200 py-3 rounded-lg text-sm font-bold bg-white text-slate-700 btn-active transition-colors";
            });
        }

        // --- 生命徵象 ---
        function submitVitals() {
            let t = document.getElementById('v-t').value;
            let pr = document.getElementById('v-pr').value;
            let rr = document.getElementById('v-rr').value;
            let sbp = document.getElementById('v-sbp').value;
            let dbp = document.getElementById('v-dbp').value;
            let spo2 = document.getElementById('v-spo2').value;
            
            let items = [];
            if(t) items.push(`T:${t}`);
            if(pr) items.push(`PR:${pr}`);
            if(rr) items.push(`RR:${rr}`);
            if(sbp || dbp) items.push(`BP:${sbp || '?'}/${dbp || '?'}`);
            if(spo2) items.push(`SpO2:${spo2}%`);
            
            if(items.length === 0) return showToast('請至少輸入一項生命徵象', true);
            logEvent('生命徵象', items.join(', '));
            
            document.getElementById('v-t').value = '';
            document.getElementById('v-pr').value = '';
            document.getElementById('v-rr').value = '';
            document.getElementById('v-sbp').value = '';
            document.getElementById('v-dbp').value = '';
            document.getElementById('v-spo2').value = '';
        }

        // --- 循環評估 ---
        function openCycleModal() {
            document.getElementById('cycle-count-label').innerText = `第 ${cycleCount} 循環`;
            selectedCycleRhythm = '';
            setPulse('');
            document.querySelectorAll('.cycle-r-btn').forEach(btn => {
                btn.classList.replace('bg-red-100', 'bg-slate-50');
                btn.classList.replace('bg-blue-100', 'bg-slate-50');
                btn.classList.replace('border-red-400', 'border-slate-200');
                btn.classList.replace('border-blue-400', 'border-slate-200');
            });
            showModal('modal-cycle');
        }

        function selectCycleRhythm(rhythm) {
            selectedCycleRhythm = rhythm;
            let noPulseGroup = ['VF', 'VT', 'PULSE VT', 'Asystole', 'PEA'];
            
            document.querySelectorAll('.cycle-r-btn').forEach(btn => {
                btn.classList.replace('bg-red-100', 'bg-slate-50');
                btn.classList.replace('bg-blue-100', 'bg-slate-50');
                btn.classList.replace('border-red-400', 'border-slate-200');
                btn.classList.replace('border-blue-400', 'border-slate-200');
            });

            let activeBtn = document.getElementById('cr-' + rhythm);
            if(noPulseGroup.includes(rhythm)) {
                activeBtn.classList.replace('bg-slate-50', 'bg-red-100');
                activeBtn.classList.replace('border-slate-200', 'border-red-400');
                setPulse('無脈搏');
            } else {
                activeBtn.classList.replace('bg-slate-50', 'bg-blue-100');
                activeBtn.classList.replace('border-slate-200', 'border-blue-400');
                setPulse('摸到脈搏');
            }
        }

        function setPulse(val) {
            activePulse = val;
            let btnNo = document.getElementById('btn-pulse-no');
            let btnYes = document.getElementById('btn-pulse-yes');
            btnNo.className = 'flex-1 py-3 rounded-xl font-bold border-2 transition-colors ' + (val === '無脈搏' ? 'border-red-400 bg-red-100 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-500');
            btnYes.className = 'flex-1 py-3 rounded-xl font-bold border-2 transition-colors ' + (val === '摸到脈搏' ? 'border-emerald-400 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500');
        }

        function confirmCycle() {
            if(!selectedCycleRhythm) return showToast('請選擇心律', true);
            if(!activePulse) return showToast('請選擇脈搏狀態', true);
            
            logEvent('循環評估', `[第${cycleCount}循環] 心律: ${selectedCycleRhythm}, ${activePulse}`);
            
            stopCprAlarm(); // 完成評估即停止循環警報
            cprSeconds = 120;
            cprTargetTimeMs = Date.now() + 120000; // 重置絕對時間
            cycleCount++;
            document.getElementById('cpr-timer').innerText = "02:00";
            
            if(activePulse === '摸到脈搏') {
                setTimeout(() => {
                    showActionToast({
                        title: 'ROSC 確認',
                        message: '已摸到脈搏，是否記錄 ROSC 並停止計時？',
                        leftText: '不要',
                        rightText: '記錄 ROSC',
                        rightAction: () => logROSC()
                    });
                }, 350);
            }
            persistCurrentCase();
            closeModal();
        }

        // --- 通用切換 ---
        function showModal(modalId) {
            document.getElementById('modal-backdrop').classList.remove('hidden');
            ['modal-med', 'modal-cycle', 'modal-summary', 'modal-report', 'modal-unit', 'modal-case-info', 'modal-stop'].forEach(id => {
                document.getElementById(id).classList.add('hidden');
                document.getElementById(id).classList.remove('flex');
            });
            document.getElementById(modalId).classList.remove('hidden');
            document.getElementById(modalId).classList.add('flex');
        }
        function closeModal() { document.getElementById('modal-backdrop').classList.add('hidden'); }

        const shockable = ['VF', 'VT', 'PULSE VT'];
        function logRhythm(rhythm) {
            logEvent('心律', rhythm);
            let panel = document.getElementById('shock-panel');
            if (shockable.includes(rhythm)) {
                panel.classList.remove('hidden');
                panel.classList.add('fade-in');
            } else {
                resetShock();
            }
        }
        function resetShock() { document.getElementById('shock-panel').classList.add('hidden'); }

        function switchTubeTab(target) {
            document.querySelectorAll('.tube-tab').forEach(el => {
                el.classList.replace('bg-teal-100', 'bg-slate-100');
                el.classList.replace('text-teal-800', 'text-slate-600');
            });
            let act = document.getElementById('tab-'+target);
            act.classList.replace('bg-slate-100', 'bg-teal-100');
            act.classList.replace('text-slate-600', 'text-teal-800');
            
            document.querySelectorAll('.tube-panel').forEach(el => el.classList.add('hidden'));
            document.getElementById('panel-'+target).classList.remove('hidden');
        }
        function logTube(type, detail) { logEvent('管路', `[${type}] ${detail}`); }

        function showToast(msg, isAlert = false, duration = 3000) {
            let toast = document.getElementById('toast');
            let icon = document.getElementById('toast-icon');
            document.getElementById('toast-msg').innerHTML = msg;
            
            if(isAlert) {
                toast.classList.replace('bg-slate-800', 'bg-red-600');
                icon.className = "fa-solid fa-triangle-exclamation text-white text-lg mt-0.5";
            } else {
                toast.classList.replace('bg-red-600', 'bg-slate-800');
                icon.className = "fa-solid fa-circle-check text-emerald-400";
            }
            
            toast.classList.remove('hidden', 'opacity-0');
            setTimeout(() => toast.classList.add('opacity-0'), duration);
            setTimeout(() => toast.classList.add('hidden'), duration + 300);
        }

        function submitCustomNote() {
            let input = document.getElementById('custom-note');
            if (input.value.trim() !== "") {
                logEvent('備註', input.value.trim());
                input.value = "";
            }
        }

        function logEvent(action, detail) {
            if(caseLocked) return;
            if(!currentCprId && action === '備註') {
                showToast('請先開始急救計時', true);
                return;
            }
            if(!currentCprId) ensureCaseCreated();
            let event = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                time: document.getElementById('real-clock').innerText,
                action: action,
                detail: detail,
                cprId: currentCprId,
                deviceId: deviceId
            };
            events.push(event);
            persistCurrentCase();
            if(!action.includes('系統')) showToast(`${action}已紀錄`);
            renderTimeline();
        }

        function switchMainTab(tab) {
            let navAct = document.getElementById('nav-actions');
            let navTime = document.getElementById('nav-timeline');
            let viewAct = document.getElementById('view-actions');
            let viewTime = document.getElementById('view-timeline');
            let headerBar = document.getElementById('header-bar');

            if(tab === 'actions') {
                headerBar.classList.remove('hidden');
                navAct.classList.replace('text-slate-400', 'text-blue-600');
                navTime.classList.replace('text-blue-600', 'text-slate-400');
                viewTime.classList.add('hidden');
                viewTime.classList.remove('flex');
                viewAct.classList.remove('hidden');
                viewAct.classList.add('flex');
            } else {
                headerBar.classList.add('hidden');
                navTime.classList.replace('text-slate-400', 'text-blue-600');
                navAct.classList.replace('text-blue-600', 'text-slate-400');
                viewAct.classList.add('hidden');
                viewAct.classList.remove('flex');
                viewTime.classList.remove('hidden');
                viewTime.classList.add('flex');
                updateTimelineMiniStatus();
                setFilter('全部');
            }
            window.scrollTo(0,0);
        }

        function setFilter(filterName) {
            currentFilter = filterName;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.replace('filter-active', 'filter-inactive');
            });
            document.getElementById('flt-' + filterName).classList.replace('filter-inactive', 'filter-active');
            renderTimeline();
        }

        function getActionColor(action) {
            if (action.includes('系統') || action.includes('備註')) return 'bg-gray-500 text-white';
            if (action.includes('循環評估')) return 'bg-orange-500 text-white';
            if (action.includes('心律') || action === '電擊') return 'bg-red-600 text-white';
            if (action === '給藥') return 'bg-purple-600 text-white';
            if (action === '大量點滴') return 'bg-cyan-600 text-white';
            if (action === '生命徵象') return 'bg-indigo-500 text-white';
            if (action === '管路' || action === '血品') return 'bg-teal-600 text-white';
            return 'bg-slate-700 text-white';
        }

        function renderTimeline() {
            updateTimelineMiniStatus();
            let list = document.getElementById('timeline-list');
            list.innerHTML = '';
            let reversed = [...events].reverse();
            
            let filtered = reversed.filter(e => {
                if (currentFilter === '全部') return true;
                if (currentFilter === '給藥' && (e.action === '給藥' || e.action === '大量點滴')) return true;
                if (currentFilter === '心律' && (e.action.includes('心律') || e.action === '電擊')) return true;
                if (currentFilter === '管路' && e.action === '管路') return true;
                if (currentFilter === '血品' && e.action === '血品') return true;
                if (currentFilter === '生命徵象' && e.action === '生命徵象') return true;
                if (currentFilter === '系統' && (e.action.includes('系統') || e.action === '備註' || e.action === '循環評估')) return true;
                return false;
            });

            if (filtered.length === 0) {
                list.innerHTML = `<li class="text-slate-500 text-sm text-center mt-10">此分類尚未有紀錄</li>`;
                return;
            }
            
            filtered.forEach(e => {
                let colorClass = e.detail.includes('ROSC') || e.detail.includes('999') ? 'text-red-400 font-bold' : 'text-slate-200';
                let li = document.createElement('li');
                li.className = 'bg-slate-700 p-2 rounded flex flex-col gap-1 shadow-sm';
                const editable = canEditCurrentCase();
                const timeControl = editable
                    ? `<input type="time" step="1" value="${e.time}" onchange="updateTime(${e.id}, this.value)" class="bg-slate-800 border border-slate-600 rounded text-teal-400 font-mono text-[10px] md:text-xs px-1 py-0.5 focus:outline-none">`
                    : `<span class="readonly-time text-teal-400 font-mono text-[10px] md:text-xs px-1 py-0.5">${e.time}</span>`;
                const deleteControl = editable
                    ? `<button onclick="confirmDel(${e.id})" class="text-slate-400 hover:text-red-400 text-xs px-2"><i class="fa-solid fa-trash"></i></button>`
                    : `<span class="text-[9px] text-slate-500 px-2"><i class="fa-solid fa-lock"></i></span>`;

                li.innerHTML = `
                    <div class="flex justify-between items-center">
                        ${timeControl}
                        ${deleteControl}
                    </div>
                    <div class="${colorClass} text-xs md:text-sm flex items-start">
                        <span class="${getActionColor(e.action)} px-1.5 py-0.5 rounded text-[10px] font-bold mr-2 shrink-0 mt-0.5">${e.action}</span>
                        <span class="leading-snug break-all">${e.detail}</span>
                    </div>
                `;
                list.appendChild(li);
            });
        }

        function updateTime(id, newTime) {
            if(!canEditCurrentCase()) return;
            let event = events.find(e => e.id === id);
            if(event) {
                event.time = newTime;
                persistCurrentCase();
                showToast('時間已更新');
            }
        }

        function confirmDel(id) {
            if(!canEditCurrentCase()) return;
            showActionToast({
                title: '刪除紀錄',
                message: '確定要刪除這筆紀錄嗎？',
                leftText: '取消',
                rightText: '確認刪除',
                danger: true,
                rightAction: () => {
                    events = events.filter(e => e.id !== id);
                    persistCurrentCase();
                    renderTimeline();
                    showToast('紀錄已刪除');
                }
            });
        }

        function openSummaryModal() {
            let list = document.getElementById('summary-list');
            list.innerHTML = '';
            
            if(Object.keys(medSummaryDict).length === 0) {
                list.innerHTML = '<li class="text-slate-400 text-center py-4">尚未給予任何藥物</li>';
            } else {
                for(let [name, qty] of Object.entries(medSummaryDict)) {
                    let unit = name.includes('500ml') ? '瓶' : '支';
                    list.innerHTML += `<li class="flex justify-between border-b border-slate-700 py-2">
                        <span>${name}</span>
                        <span class="font-bold text-teal-300">${qty} ${unit}</span>
                    </li>`;
                }
            }
            showModal('modal-summary');
        }

        function openReportModal() {
            if (events.length === 0) return showToast('無紀錄可生成', true);
            let output = document.getElementById('report-output');
            let sorted = [...events].sort((a, b) => a.time.localeCompare(b.time));
            
            let text = `【急診急救護理紀錄】\n`;
            text += `CPR ID: ${currentCprId || '未建立'}\n`;
            text += `病房: ${deviceUnit || '未設定'}\n`;
            text += `床號: ${currentBed || '未填'}\n`;
            text += `紀錄護理師員編: ${currentNurseId || '未填'}\n`;
            text += `啟動時間: ${systemStartTime || '未記錄'}\n`;
            if(cprEndTime) text += `停止時間: ${cprEndTime}\n`;
            text += `急救總歷時: ${document.getElementById('total-timer').innerText}\n`;
            text += `紀錄狀態: ${caseLocked ? '已封存' : '進行中'}\n`;
            text += `-----------------\n`;
            sorted.forEach(e => { text += `[${e.time}] ${e.action}: ${e.detail}\n`; });
            
            text += `-----------------\n【藥物與點滴總計】\n`;
            if(Object.keys(medSummaryDict).length === 0) {
                text += `(無給藥紀錄)\n`;
            } else {
                for(let [name, qty] of Object.entries(medSummaryDict)) {
                    let unit = name.includes('500ml') ? '瓶' : '支';
                    let info = medDict[name];
                    if(info) {
                        let calcVal = formatDose(info.val * qty);
                        let calcMl = formatDose(info.ml * qty);
                        text += `${name}: ${qty} ${unit} (${calcVal}${info.unit})\n`;
                    } else {
                        text += `${name}: ${qty} ${unit}\n`;
                    }
                }
            }
            
            text += `-----------------\n紀錄護理師員編: ${currentNurseId || '未填'}`;
            
            output.value = text;
            showModal('modal-report');
        }

        function copyReport() {
            let output = document.getElementById('report-output');
            output.select();
            output.setSelectionRange(0, 99999); 
            navigator.clipboard.writeText(output.value).then(() => {
                showToast("✅ 已複製到剪貼簿", false);
            }).catch(() => {
                showToast('複製失敗，請手動全選複製', true);
            });
        }


// ============================================================
// V16：Supabase 即時同步 + 同網址電腦監看
// ============================================================
const V16_PENDING_FINALIZE_KEY = 'cpr_v16_pending_finalizations';
let cloudDeviceId = '';
let cloudCaseId = '';
let cloudCaseCreatingPromise = null;
let cloudRuntimeTimer = null;
let cloudOnline = navigator.onLine;
let currentAppMode = 'mobile';

// 電腦版狀態
let desktopProfile = null;
let desktopUnit = null;
let desktopCases = [];
let desktopEvents = [];
let desktopSelectedCaseId = '';
let desktopFilter = '全部';
let desktopRealtimeChannel = null;
let desktopRefreshTimer = null;

function isLikelyIPadOrMobile() {
    const ua = navigator.userAgent || '';
    const iPadDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod|Android/i.test(ua) || iPadDesktopUA;
}

function shouldUseDesktopMode() {
    return window.innerWidth >= 900 && !isLikelyIPadOrMobile();
}

function setAppMode(mode) {
    currentAppMode = mode;
    const mobileIds = ['header-bar','mobile-main','mobile-nav','modal-backdrop','toast','action-toast'];
    const desktop = document.getElementById('desktop-app');
    if(mode === 'desktop') {
        mobileIds.forEach(id => document.getElementById(id)?.classList.add('hidden'));
        desktop.classList.remove('hidden');
        document.body.classList.remove('pb-[80px]');
        document.body.classList.add('pb-0');
    } else {
        desktop.classList.add('hidden');
        ['header-bar','mobile-main','mobile-nav'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
        document.body.classList.add('pb-[80px]');
        document.body.classList.remove('pb-0');
    }
}

function setCloudStatus(status, detail = '') {
    cloudOnline = status !== 'offline';
    const el = document.getElementById('local-status');
    if(!el) return;
    if(status === 'synced') {
        el.className = 'text-emerald-300';
        el.innerHTML = '<i class="fa-solid fa-circle text-[6px]"></i> 已同步';
    } else if(status === 'syncing') {
        el.className = 'text-sky-300';
        el.innerHTML = '<i class="fa-solid fa-rotate text-[9px]"></i> 同步中';
    } else if(status === 'offline') {
        el.className = 'text-red-300';
        el.innerHTML = '<i class="fa-solid fa-cloud-arrow-down text-[9px]"></i> 離線';
    } else {
        el.className = 'text-amber-300';
        el.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-[9px]"></i> ' + (detail || '待同步');
    }
}

function localDateTimeToIso(ms = Date.now()) {
    return new Date(ms).toISOString();
}

function eventTimeIsoFromClock(clock, baseIso = null) {
    const base = baseIso ? new Date(baseIso) : new Date(cprStartedAtMs || Date.now());
    const parts = String(clock || '').split(':').map(Number);
    if(parts.length >= 2) {
        base.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
    }
    return base.toISOString();
}

function clientEventKey() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `EV-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
}

async function loadUnitOptions() {
    const select = document.getElementById('device-unit-select');
    try {
        const { data, error } = await supabaseClient.rpc('list_active_units');
        if(error) throw error;
        if(Array.isArray(data) && data.length) {
            select.innerHTML = '<option value="">請選擇</option>' + data.map(u => `<option value="${escapeHtml(u.code)}">${escapeHtml(u.code)}${u.name && u.name !== u.code ? '｜' + escapeHtml(u.name) : ''}</option>`).join('');
        }
    } catch(err) {
        console.warn('讀取單位清單失敗', err);
        select.innerHTML = '<option value="">單位讀取失敗</option>';
    }
}

async function registerCloudDevice(unitCode = deviceUnit) {
    setCloudStatus('syncing');
    try {
        const { data, error } = await supabaseClient.rpc('register_device', {
            p_device_key: deviceId,
            p_unit_code: unitCode
        });
        if(error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        cloudDeviceId = row?.device_id || '';
        setCloudStatus('synced');
        return true;
    } catch(err) {
        console.error('裝置註冊失敗', err);
        setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
        return false;
    }
}

function buildCaseSnapshot() {
    return {
        schemaVersion: 3,
        savedAtMs: Date.now(),
        deviceId,
        deviceUnit,
        currentCprId,
        cloudCaseId,
        recordingDeviceId,
        currentBed,
        currentNurseId,
        cprStartedAtMs,
        cprEndedAtMs,
        cprEndTime,
        caseLocked,
        roscRecorded,
        isRunning,
        isTotalTimerRunning,
        totalSeconds,
        cprSeconds,
        epiSeconds,
        cycleCount,
        systemStartTime,
        events,
        medSummaryDict,
        givenMedSet: Array.from(givenMedSet),
        totalStartTimeMs,
        pausedTotalElapsedMs,
        cprTargetTimeMs,
        epiTargetTimeMs
    };
}

function persistCurrentCase() {
    if(!currentCprId || caseLocked) return;
    try {
        localStorage.setItem(V15_ACTIVE_CASE_KEY, JSON.stringify(buildCaseSnapshot()));
    } catch(err) {
        console.error('儲存 CPR 本機狀態失敗', err);
    }
    scheduleCloudRuntimeSave();
}

function scheduleCloudRuntimeSave() {
    clearTimeout(cloudRuntimeTimer);
    cloudRuntimeTimer = setTimeout(saveCloudRuntimeState, 450);
}

async function saveCloudRuntimeState() {
    if(!cloudCaseId || !deviceId || caseLocked) return;
    try {
        const state = buildCaseSnapshot();
        // 事件已有獨立資料表，不重複塞入 runtime_state
        delete state.events;
        const { error } = await supabaseClient.rpc('device_save_runtime_state', {
            p_device_key: deviceId,
            p_case_id: cloudCaseId,
            p_runtime_state: state
        });
        if(error) throw error;
        setCloudStatus('synced');
    } catch(err) {
        console.warn('同步即時狀態失敗', err);
        setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
    }
}

async function startCloudCaseIfNeeded() {
    if(cloudCaseId) return cloudCaseId;
    if(!currentCprId || !cprStartedAtMs) return '';
    if(cloudCaseCreatingPromise) return cloudCaseCreatingPromise;

    cloudCaseCreatingPromise = (async () => {
        setCloudStatus('syncing');
        try {
            await retryPendingFinalizations();
            if(!cloudDeviceId) await registerCloudDevice(deviceUnit);
            const { data, error } = await supabaseClient.rpc('device_start_cpr_v16', {
                p_device_key: deviceId,
                p_client_case_key: currentCprId,
                p_started_at: new Date(cprStartedAtMs).toISOString()
            });
            if(error) throw error;
            const row = Array.isArray(data) ? data[0] : data;
            cloudCaseId = row?.id || '';
            if(!cloudCaseId) throw new Error('未取得雲端 CPR ID');
            try { localStorage.setItem(V15_ACTIVE_CASE_KEY, JSON.stringify(buildCaseSnapshot())); } catch(_) {}
            await flushPendingEvents();
            await saveCloudRuntimeState();
            setCloudStatus('synced');
            return cloudCaseId;
        } catch(err) {
            console.error('建立雲端 CPR 失敗', err);
            setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
            return '';
        } finally {
            cloudCaseCreatingPromise = null;
        }
    })();
    return cloudCaseCreatingPromise;
}

function ensureCaseCreated() {
    if(currentCprId) return;
    currentCprId = createCprId();
    cloudCaseId = '';
    recordingDeviceId = deviceId;
    cprStartedAtMs = Date.now();
    currentBed = '';
    currentNurseId = '';
    caseLocked = false;
    roscRecorded = false;
    updateCaseInfoBar();
    persistCurrentCase();
    startCloudCaseIfNeeded();
}

function addLocalEvent(action, detail, payload = {}, showDefaultToast = true) {
    if(caseLocked) return null;
    if(!currentCprId && action === '備註') {
        showToast('請先開始急救計時', true);
        return null;
    }
    if(!currentCprId) ensureCaseCreated();
    const clock = document.getElementById('real-clock').innerText;
    const event = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        clientEventKey: clientEventKey(),
        cloudId: '',
        time: clock,
        eventTimeIso: eventTimeIsoFromClock(clock),
        action,
        detail,
        payload: payload || {},
        cprId: currentCprId,
        deviceId
    };
    events.push(event);
    persistCurrentCase();
    syncSingleEvent(event);
    if(showDefaultToast && !action.includes('系統')) showToast(`${action}已紀錄`);
    renderTimeline();
    return event;
}

function logEvent(action, detail, payload = {}) {
    return addLocalEvent(action, detail, payload, true);
}

function eventCategory(action) {
    if(action === '給藥' || action === '大量點滴') return '給藥/點滴';
    if(action.includes('心律') || action === '電擊') return '心律/電擊';
    if(action === '管路') return '管路';
    if(action === '血品') return '血品';
    if(action === '生命徵象') return '生命徵象';
    return '系統/備註';
}

async function syncSingleEvent(event) {
    if(!event || event.cloudId || event.pendingDelete) return;
    const caseId = cloudCaseId || await startCloudCaseIfNeeded();
    if(!caseId) return;
    setCloudStatus('syncing');
    try {
        const { data, error } = await supabaseClient.rpc('device_add_event_v16', {
            p_device_key: deviceId,
            p_case_id: caseId,
            p_client_event_key: event.clientEventKey || String(event.id),
            p_event_time: event.eventTimeIso || eventTimeIsoFromClock(event.time),
            p_category: eventCategory(event.action),
            p_action: event.action,
            p_detail: event.detail,
            p_payload: event.payload || {}
        });
        if(error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        event.cloudId = row?.id || event.cloudId;
        event.eventTimeIso = row?.event_time || event.eventTimeIso;
        try { localStorage.setItem(V15_ACTIVE_CASE_KEY, JSON.stringify(buildCaseSnapshot())); } catch(_) {}
        setCloudStatus('synced');
    } catch(err) {
        console.warn('事件尚未同步', err);
        setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
    }
}

async function flushPendingEvents() {
    const pending = events.filter(e => !e.cloudId && !e.pendingDelete);
    for(const event of pending) await syncSingleEvent(event);
}

async function saveCaseInfo() {
    if(!canEditCurrentCase()) return closeModal();
    currentBed = document.getElementById('case-bed-input').value.trim();
    currentNurseId = document.getElementById('case-nurse-input').value.trim();
    updateCaseInfoBar();
    persistCurrentCase();
    closeModal();
    showToast('本次 CPR 資料已更新');
    const caseId = cloudCaseId || await startCloudCaseIfNeeded();
    if(caseId) {
        try {
            const { error } = await supabaseClient.rpc('device_update_case_identity', {
                p_device_key: deviceId,
                p_case_id: caseId,
                p_bed_no: currentBed,
                p_recorder_staff_no: currentNurseId
            });
            if(error) throw error;
            setCloudStatus('synced');
        } catch(err) {
            console.warn('床號/員編待同步', err);
            setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
        }
    }
}

async function updateTime(id, newTime) {
    if(!canEditCurrentCase()) return;
    const event = events.find(e => e.id === id);
    if(!event) return;
    event.time = newTime;
    event.eventTimeIso = eventTimeIsoFromClock(newTime, event.eventTimeIso || null);
    persistCurrentCase();
    showToast('時間已更新');
    if(event.cloudId) {
        try {
            const { error } = await supabaseClient.rpc('device_update_event_time', {
                p_device_key: deviceId,
                p_event_id: event.cloudId,
                p_event_time: event.eventTimeIso
            });
            if(error) throw error;
            setCloudStatus('synced');
        } catch(err) {
            console.warn('時間修改待同步', err);
            queueFinalizationOp({ type:'updateEventTime', cloudEventId:event.cloudId, eventTimeIso:event.eventTimeIso });
            setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
        }
    }
}

function confirmDel(id) {
    if(!canEditCurrentCase()) return;
    showActionToast({
        title: '刪除紀錄',
        message: '確定要刪除這筆紀錄嗎？',
        leftText: '取消',
        rightText: '確認刪除',
        danger: true,
        rightAction: async () => {
            const event = events.find(e => e.id === id);
            events = events.filter(e => e.id !== id);
            persistCurrentCase();
            renderTimeline();
            showToast('紀錄已刪除');
            if(event?.cloudId) {
                try {
                    const { error } = await supabaseClient.rpc('device_delete_event', {
                        p_device_key: deviceId,
                        p_event_id: event.cloudId
                    });
                    if(error) throw error;
                    setCloudStatus('synced');
                } catch(err) {
                    console.warn('刪除待同步', err);
                    queueFinalizationOp({ type:'deleteEvent', cloudEventId:event.cloudId });
                    setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
                }
            }
        }
    });
}

function confirmMed() {
    let type = activeMedName.includes('大量點滴') ? '大量點滴' : '給藥';
    let unit = activeMedName.includes('500ml') ? '瓶' : '支';
    let detail = `${activeMedName} x ${activeMedQty} ${unit}`;
    let info = medDict[activeMedName];
    if(info) {
        let calcVal = formatDose(info.val * activeMedQty);
        let calcMl = formatDose(info.ml * activeMedQty);
        detail += ` (${calcVal}${info.unit}/${calcMl}ml)`;
    }
    let needPrep = (activeMedName === 'Norepinephrine' || activeMedName.includes('Dopamin') || (activeMedName.includes('Cordarone') && activeMedQty >= 6));
    let pumpRun = null;
    if(needPrep) {
        pumpRun = document.getElementById('med-pump-run').value;
        detail += ` (加至 ${prepSol} ${prepVol}mL, Pump run: ${pumpRun} 滴/分)`;
    }

    if(activeMedName.includes('Adrenalin')) {
        updateMedSummary(activeMedName, activeMedQty);
        let count = medSummaryDict[activeMedName];
        stopEpiAlarm();
        epiSeconds = 180;
        epiTargetTimeMs = Date.now() + 180000;
        let countBadge = document.getElementById('epi-badge-count');
        let timerBadge = document.getElementById('epi-timer-badge');
        countBadge.innerText = count;
        countBadge.classList.remove('hidden');
        timerBadge.innerText = '03:00';
        timerBadge.classList.remove('hidden', 'bg-red-800', 'bg-slate-500', 'timer-warning');
        timerBadge.classList.add('bg-red-600');
    } else {
        updateMedSummary(activeMedName, activeMedQty);
    }

    const conflicts = checkIncompat(activeMedName);
    givenMedSet.add(activeMedName);
    addLocalEvent(type, detail, {
        kind: 'medication',
        medication_name: activeMedName,
        qty: activeMedQty,
        unit,
        preparation: needPrep ? { solution: prepSol, volume_ml: Number(prepVol), pump_run: pumpRun ? Number(pumpRun) : null, pump_unit:'滴/分' } : null
    }, false);

    if(conflicts.length > 0) {
        setTimeout(() => showToast(`⚠️ 注意：與 ${conflicts.join(', ')} 不相容<br><span class="text-[13px] text-red-200 mt-1 block">請建立另一條 IV Set (分開給藥)</span>`, true, 5000), 100);
    } else {
        showToast(`${type}已紀錄`);
    }
    closeModal();
}

async function syncMarkRosc() {
    const caseId = cloudCaseId || await startCloudCaseIfNeeded();
    if(!caseId) return;
    try {
        const { error } = await supabaseClient.rpc('device_mark_rosc', {
            p_device_key: deviceId,
            p_case_id: caseId,
            p_rosc_at: new Date().toISOString()
        });
        if(error) throw error;
        setCloudStatus('synced');
    } catch(err) {
        console.warn('ROSC 狀態待同步', err);
    }
}

// V15.2 原流程不變，只在紀錄 ROSC 後補同步 cpr_cases.rosc_at
const _v16OriginalLogROSC = logROSC;
logROSC = function() {
    const before = roscRecorded;
    _v16OriginalLogROSC();
    if(!before && roscRecorded) syncMarkRosc();
};

function getPendingFinalizationOps() {
    try {
        const raw = localStorage.getItem(V16_PENDING_FINALIZE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch(_) { return []; }
}

function savePendingFinalizationOps(list) {
    localStorage.setItem(V16_PENDING_FINALIZE_KEY, JSON.stringify(list));
}

function queueFinalizationOp(op) {
    const list = getPendingFinalizationOps();
    list.push({ ...op, id: clientEventKey(), queuedAt: Date.now() });
    savePendingFinalizationOps(list.slice(-30));
}

async function retryPendingFinalizations() {
    if(!navigator.onLine) return;
    const list = getPendingFinalizationOps();
    if(!list.length) return;
    const remain = [];
    for(const op of list) {
        try {
            if(op.type === 'deleteEvent') {
                const { error } = await supabaseClient.rpc('device_delete_event', { p_device_key:deviceId, p_event_id:op.cloudEventId });
                if(error) throw error;
            } else if(op.type === 'updateEventTime') {
                const { error } = await supabaseClient.rpc('device_update_event_time', { p_device_key:deviceId, p_event_id:op.cloudEventId, p_event_time:op.eventTimeIso });
                if(error) throw error;
            } else if(op.type === 'stopCase') {
                for(const ev of (op.unsyncedEvents || [])) await cloudAddArchivedEvent(op.cloudCaseId, ev);
                const { error } = await supabaseClient.rpc('device_stop_cpr', {
                    p_device_key:deviceId, p_case_id:op.cloudCaseId, p_bed_no:op.bed, p_recorder_staff_no:op.nurse
                });
                if(error) throw error;
            } else if(op.type === 'closeForNew') {
                for(const ev of (op.unsyncedEvents || [])) await cloudAddArchivedEvent(op.cloudCaseId, ev);
                const { error } = await supabaseClient.rpc('device_close_pending_for_new_cpr', { p_device_key:deviceId, p_case_id:op.cloudCaseId });
                if(error) throw error;
            }
        } catch(err) {
            console.warn('延後同步仍未完成', op.type, err);
            remain.push(op);
        }
    }
    savePendingFinalizationOps(remain);
}

async function cloudAddArchivedEvent(caseId, ev) {
    if(!caseId || !ev) return;
    const { error } = await supabaseClient.rpc('device_add_event_v16', {
        p_device_key:deviceId,
        p_case_id:caseId,
        p_client_event_key:ev.clientEventKey || String(ev.id),
        p_event_time:ev.eventTimeIso || eventTimeIsoFromClock(ev.time),
        p_category:eventCategory(ev.action),
        p_action:ev.action,
        p_detail:ev.detail,
        p_payload:ev.payload || {}
    });
    if(error) throw error;
}

async function confirmStopCPR() {
    if(!canEditCurrentCase()) return;
    const bed = document.getElementById('stop-bed-input').value.trim();
    const nurse = document.getElementById('stop-nurse-input').value.trim();
    if(!bed) return showToast('請輸入床號', true);
    if(!nurse) return showToast('請輸入紀錄護理師員編', true);

    currentBed = bed;
    currentNurseId = nurse;
    cprEndedAtMs = Date.now();
    cprEndTime = new Date(cprEndedAtMs).toTimeString().substring(0,8);
    addLocalEvent('系統', `⛔ 停止急救｜${deviceUnit} ${currentBed}床｜紀錄護理師員編 ${currentNurseId}`, { kind:'stop_cpr' }, false);

    isRunning = false;
    isTotalTimerRunning = false;
    clearInterval(timerInterval);
    stopCprAlarm();
    stopEpiAlarm();
    releaseWakeLock();
    cprTargetTimeMs = 0;
    epiTargetTimeMs = 0;

    const caseId = cloudCaseId || await startCloudCaseIfNeeded();
    await flushPendingEvents();
    if(caseId) {
        try {
            const { error } = await supabaseClient.rpc('device_stop_cpr', {
                p_device_key:deviceId,
                p_case_id:caseId,
                p_bed_no:currentBed,
                p_recorder_staff_no:currentNurseId
            });
            if(error) throw error;
            setCloudStatus('synced');
        } catch(err) {
            console.warn('停止急救將於網路恢復後補同步', err);
            queueFinalizationOp({
                type:'stopCase', cloudCaseId:caseId, bed:currentBed, nurse:currentNurseId,
                unsyncedEvents: events.filter(e => !e.cloudId)
            });
            setCloudStatus(navigator.onLine ? 'pending' : 'offline', '待同步');
        }
    }

    caseLocked = true;
    archiveCurrentCase('手動停止急救');
    closeModal();
    const stoppedBed = currentBed;
    resetForNewCPR();
    showToast(`本次 CPR 已停止並封存${stoppedBed ? `｜${stoppedBed}床` : ''}`);
}

function normalizeCloudEvent(row, index = 0) {
    const d = new Date(row.event_time);
    return {
        id: Date.now() + index + Math.floor(Math.random()*1000),
        clientEventKey: row.client_event_key || '',
        cloudId: row.id,
        time: d.toTimeString().substring(0,8),
        eventTimeIso: row.event_time,
        action: row.action,
        detail: row.detail || '',
        payload: row.payload || {},
        cprId: currentCprId,
        deviceId
    };
}

async function fetchCloudEvents(caseId) {
    try {
        const { data, error } = await supabaseClient.rpc('device_get_case_events', { p_device_key:deviceId, p_case_id:caseId });
        if(error) throw error;
        return (data || []).map(normalizeCloudEvent);
    } catch(err) {
        console.warn('讀取雲端時間軸失敗', err);
        return [];
    }
}

function rebuildMedicationSummaryFromEvents(list) {
    const dict = {};
    const set = new Set();
    (list || []).forEach(e => {
        if(e.action !== '給藥' && e.action !== '大量點滴') return;
        const p = e.payload || {};
        let name = p.medication_name;
        let qty = Number(p.qty);
        if(!name) {
            const m = String(e.detail || '').match(/^(.+?)\s+x\s+([\d.]+)\s+(支|瓶)/);
            if(m) { name = m[1]; qty = Number(m[2]); }
        }
        if(name && Number.isFinite(qty)) {
            dict[name] = (dict[name] || 0) + qty;
            set.add(name);
        }
    });
    return { dict, set };
}

async function restoreCloudCase(row, localStored = null) {
    const cloudEvents = await fetchCloudEvents(row.id);
    let snapshot = localStored && localStored.currentCprId
        ? { ...localStored }
        : { ...(row.runtime_state || {}) };

    snapshot.cloudCaseId = row.id;
    snapshot.currentCprId = snapshot.currentCprId || row.client_case_key || `CPR-${String(row.id).slice(0,8)}`;
    snapshot.deviceId = deviceId;
    snapshot.deviceUnit = deviceUnit;
    snapshot.currentBed = row.bed_no || snapshot.currentBed || '';
    snapshot.currentNurseId = row.recorder_staff_no || snapshot.currentNurseId || '';
    snapshot.cprStartedAtMs = new Date(row.started_at).getTime();
    snapshot.roscRecorded = !!row.rosc_at || !!snapshot.roscRecorded;
    snapshot.caseLocked = false;

    const localUnsynced = (localStored?.events || []).filter(e => !e.cloudId);
    const seen = new Set(cloudEvents.map(e => e.clientEventKey).filter(Boolean));
    snapshot.events = [...cloudEvents, ...localUnsynced.filter(e => !seen.has(e.clientEventKey))].sort((a,b) => String(a.eventTimeIso||'').localeCompare(String(b.eventTimeIso||'')));
    const meds = rebuildMedicationSummaryFromEvents(snapshot.events);
    if(!snapshot.medSummaryDict || Object.keys(snapshot.medSummaryDict).length === 0) snapshot.medSummaryDict = meds.dict;
    if(!snapshot.givenMedSet || snapshot.givenMedSet.length === 0) snapshot.givenMedSet = Array.from(meds.set);
    restoreStoredCase(snapshot);
    cloudCaseId = row.id;
    await flushPendingEvents();
    await saveCloudRuntimeState();
}

async function closePendingAndStartNew(row, localStored) {
    const unsynced = (localStored?.events || []).filter(e => !e.cloudId);
    try {
        for(const ev of unsynced) await cloudAddArchivedEvent(row.id, ev);
        const { error } = await supabaseClient.rpc('device_close_pending_for_new_cpr', { p_device_key:deviceId, p_case_id:row.id });
        if(error) throw error;
    } catch(err) {
        queueFinalizationOp({ type:'closeForNew', cloudCaseId:row.id, unsyncedEvents:unsynced });
    }
    if(localStored) archiveSnapshot(localStored, '建立新 CPR 時自動封存');
    clearStoredActiveCase();
    resetForNewCPR();
    showToast('上一筆 CPR 已封存，可開始新的急救');
}

async function checkPendingCaseOnLaunch() {
    if(restorePromptShown) return;
    const localStored = getStoredActiveCase();
    try {
        const { data, error } = await supabaseClient.rpc('device_get_pending_cpr', { p_device_key:deviceId });
        if(error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if(row) {
            restorePromptShown = true;
            const started = new Date(row.started_at).getTime();
            showActionToast({
                title:'偵測到尚未結束的 CPR',
                message:`病房：${deviceUnit}\nCPR開始時間：${formatDateTime(started)}`,
                leftText:'開始新的 CPR',
                rightText:'恢復紀錄',
                leftAction:() => closePendingAndStartNew(row, localStored),
                rightAction:() => restoreCloudCase(row, localStored)
            });
            return;
        }
    } catch(err) {
        console.warn('雲端未完成 CPR 查詢失敗，改用本機判斷', err);
    }

    if(localStored) {
        const started = Number(localStored.cprStartedAtMs || 0);
        if(started && Date.now() - started < V15_MAX_ACTIVE_MS) {
            restorePromptShown = true;
            showActionToast({
                title:'偵測到尚未結束的 CPR',
                message:`病房：${localStored.deviceUnit || deviceUnit}\nCPR開始時間：${formatDateTime(started)}`,
                leftText:'開始新的 CPR',
                rightText:'恢復紀錄',
                leftAction:() => {
                    archiveSnapshot(localStored, '建立新 CPR 時自動封存');
                    clearStoredActiveCase();
                    resetForNewCPR();
                },
                rightAction:() => restoreStoredCase(localStored)
            });
        } else if(started) {
            archiveSnapshot(localStored, '超過8小時未手動停止');
            clearStoredActiveCase();
        }
    }
}

async function confirmDeviceUnit() {
    const unit = document.getElementById('device-unit-select').value;
    if(!unit) return showToast('請選擇使用單位', true);
    deviceUnit = unit;
    localStorage.setItem(V15_DEVICE_UNIT_KEY, unit);
    updateCaseInfoBar();
    closeModal();
    const ok = await registerCloudDevice(unit);
    showToast(ok ? `此裝置已設定為 ${unit}，Supabase 已連線` : `此裝置已設定為 ${unit}，目前使用本機模式`);
    setTimeout(checkPendingCaseOnLaunch, 250);
}

async function initV16Mobile() {
    deviceId = getOrCreateDeviceId();
    await loadUnitOptions();
    const savedUnit = localStorage.getItem(V15_DEVICE_UNIT_KEY);
    if(savedUnit) {
        deviceUnit = savedUnit;
        updateCaseInfoBar();
        await registerCloudDevice(savedUnit);
        await retryPendingFinalizations();
        setTimeout(checkPendingCaseOnLaunch, 120);
    } else {
        deviceUnit = '';
        updateCaseInfoBar();
        // V2：第一次在這台裝置進入 CPR 模式時，先選擇單位。
        // 選過一次後會記住，不會每次急救都重問。
        setTimeout(() => showModal('modal-unit'), 120);
    }
}

// ---------- 電腦版 ----------
function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    icon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
}

function desktopSetLoginError(msg = '') {
    const el = document.getElementById('desktop-login-error');
    if(!msg) { el.classList.add('hidden'); el.innerText=''; return; }
    el.innerText = msg;
    el.classList.remove('hidden');
}

async function desktopLogin() {
    const username = document.getElementById('desktop-username').value.trim().toUpperCase();
    const password = document.getElementById('desktop-password').value;
    if(!username) return desktopSetLoginError('請輸入帳號');
    if(!password) return desktopSetLoginError('請輸入密碼');
    desktopSetLoginError('');
    const btn = document.getElementById('desktop-login-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 登入中...';
    try {
        const email = username.includes('@') ? username.toLowerCase() : `${username.toLowerCase()}@unit.cpr.local`;
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if(error) throw error;
        await initDesktopSession();
    } catch(err) {
        console.error(err);
        desktopSetLoginError('帳號或密碼錯誤，或此帳號尚未啟用。');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket mr-1"></i> 登入';
    }
}

async function desktopLogout() {
    if(desktopRealtimeChannel) await supabaseClient.removeChannel(desktopRealtimeChannel);
    desktopRealtimeChannel = null;
    await supabaseClient.auth.signOut();
    desktopProfile = null;
    desktopUnit = null;
    document.getElementById('desktop-dashboard').classList.add('hidden');
    document.getElementById('desktop-login').classList.remove('hidden');
    document.getElementById('desktop-password').value = '';
}

async function initDesktopSession() {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if(!session) {
        document.getElementById('desktop-login').classList.remove('hidden');
        document.getElementById('desktop-dashboard').classList.add('hidden');
        return;
    }
    const { data: profile, error } = await supabaseClient.from('profiles').select('*').eq('user_id', session.user.id).single();
    if(error || !profile || profile.approval !== 'approved') {
        await supabaseClient.auth.signOut();
        desktopSetLoginError('此帳號尚未通過審核或已停用。');
        return;
    }
    desktopProfile = profile;
    if(profile.unit_id) {
        const { data: unit } = await supabaseClient.from('units').select('*').eq('id', profile.unit_id).single();
        desktopUnit = unit || null;
    } else desktopUnit = null;

    document.getElementById('desktop-login').classList.add('hidden');
    document.getElementById('desktop-dashboard').classList.remove('hidden');
    const scopeName = desktopProfile.role === 'admin' ? '全院' : (desktopUnit?.code || desktopProfile.username);
    document.getElementById('desktop-title').innerText = `${scopeName} CPR 即時監看`;
    const roleName = desktopProfile.role === 'admin' ? '管理者' : desktopProfile.role === 'head_nurse' ? '護理長' : '單位帳號';
    document.getElementById('desktop-role-label').innerText = `${roleName}｜${desktopProfile.username}`;
    document.getElementById('desktop-history-title').innerText = desktopProfile.role === 'unit' ? '近 3 天 CPR 紀錄' : '歷史 CPR 紀錄';
    await refreshDesktopDashboard(false);
    subscribeDesktopRealtime();
}

async function initV16Desktop() {
    document.getElementById('desktop-username').addEventListener('keydown', e => { if(e.key === 'Enter') document.getElementById('desktop-password').focus(); });
    document.getElementById('desktop-password').addEventListener('keydown', e => { if(e.key === 'Enter') desktopLogin(); });
    await initDesktopSession();
}

async function queryDesktopCases(status) {
    let q = supabaseClient.from('cpr_cases')
        .select('id,unit_id,client_case_key,bed_no,recorder_staff_no,started_at,rosc_at,ended_at,status,close_reason,runtime_state,updated_at')
        .eq('status', status)
        .order('started_at', { ascending:false })
        .limit(status === 'active' ? 30 : 100);
    if(desktopProfile.role !== 'admin' && desktopProfile.unit_id) q = q.eq('unit_id', desktopProfile.unit_id);
    if(desktopProfile.role === 'unit' && status === 'closed') {
        q = q.gte('started_at', new Date(Date.now() - 3*24*60*60*1000).toISOString());
    }
    const { data, error } = await q;
    if(error) throw error;
    return data || [];
}

async function refreshDesktopDashboard(showFeedback = false) {
    if(!desktopProfile) return;
    try {
        const [active, history] = await Promise.all([queryDesktopCases('active'), queryDesktopCases('closed')]);
        desktopCases = [...active, ...history];
        let latestMap = {};
        if(active.length) {
            const { data: evs } = await supabaseClient.from('cpr_events')
                .select('cpr_case_id,event_time,action,detail')
                .in('cpr_case_id', active.map(x=>x.id))
                .eq('is_deleted', false)
                .order('event_time', {ascending:false});
            (evs || []).forEach(e => { if(!latestMap[e.cpr_case_id]) latestMap[e.cpr_case_id] = e; });
        }
        renderDesktopCaseLists(active, history, latestMap);
        if(desktopSelectedCaseId) await openDesktopCase(desktopSelectedCaseId, true);
        document.getElementById('desktop-last-sync').innerText = new Date().toLocaleString('zh-TW', {hour12:false});
        if(showFeedback) desktopFlashLiveBadge('已更新');
    } catch(err) {
        console.error('Dashboard 更新失敗', err);
        desktopFlashLiveBadge('同步異常', true);
    }
}

function renderDesktopCaseLists(active, history, latestMap) {
    document.getElementById('desktop-active-count').innerText = active.length;
    const activeEl = document.getElementById('desktop-active-list');
    activeEl.innerHTML = active.length ? active.map(c => {
        const latest = latestMap[c.id];
        return `<button onclick="openDesktopCase('${c.id}')" class="w-full text-left border rounded-xl p-3 transition ${desktopSelectedCaseId===c.id?'border-blue-500 bg-blue-50':'border-slate-200 hover:border-blue-300 bg-white'}">
            <div class="flex justify-between items-center gap-2"><span class="font-extrabold text-slate-900">${escapeHtml(c.bed_no ? c.bed_no+'床' : '床號待補')}</span><span class="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">CPR中</span></div>
            <div class="text-xs text-slate-500 mt-1">開始 ${formatDesktopDate(c.started_at)}</div>
            <div class="text-sm mt-2 truncate ${latest?'text-slate-700':'text-slate-400'}">${latest ? `最新：${escapeHtml(latest.action)}｜${escapeHtml(latest.detail || '')}` : '尚無處置紀錄'}</div>
        </button>`;
    }).join('') : '<div class="text-sm text-slate-400 text-center py-8">目前沒有進行中的 CPR</div>';

    const histEl = document.getElementById('desktop-history-list');
    histEl.innerHTML = history.length ? history.map(c => `<button onclick="openDesktopCase('${c.id}')" class="w-full text-left border rounded-xl p-3 transition ${desktopSelectedCaseId===c.id?'border-blue-500 bg-blue-50':'border-slate-200 hover:border-blue-300 bg-white'}">
        <div class="flex justify-between items-center gap-2"><span class="font-extrabold text-slate-800">${escapeHtml(c.bed_no ? c.bed_no+'床' : '床號未填')}</span><span class="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">已封存</span></div>
        <div class="text-xs text-slate-500 mt-1">${formatDesktopDate(c.started_at)}</div>
        <div class="text-[11px] text-slate-400 mt-1">${desktopCloseReason(c.close_reason)}</div>
    </button>`).join('') : '<div class="text-sm text-slate-400 text-center py-8">目前沒有歷史紀錄</div>';
}

function desktopCloseReason(reason) {
    if(reason === 'manual_stop') return '手動停止急救';
    if(reason === 'auto_8h') return '超過 8 小時系統自動封存';
    if(reason === 'new_cpr_started') return '建立新 CPR 時自動封存';
    return reason || '已封存';
}

async function openDesktopCase(caseId, silent = false) {
    desktopSelectedCaseId = caseId;
    const c = desktopCases.find(x => x.id === caseId);
    if(!c) return;
    try {
        const { data, error } = await supabaseClient.from('cpr_events')
            .select('*').eq('cpr_case_id', caseId).eq('is_deleted', false).order('event_time', {ascending:false});
        if(error) throw error;
        desktopEvents = data || [];
        document.getElementById('desktop-empty-detail').classList.add('hidden');
        document.getElementById('desktop-case-detail').classList.remove('hidden');
        document.getElementById('desktop-case-name').innerText = `${desktopUnit?.code || 'CPR'}｜${c.bed_no ? c.bed_no+'床' : '床號待補'}`;
        const statusEl = document.getElementById('desktop-case-status');
        if(c.status === 'active') {
            statusEl.innerText = c.rosc_at ? 'ROSC後觀察中' : 'CPR中';
            statusEl.className = c.rosc_at ? 'text-xs font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700' : 'text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700';
        } else {
            statusEl.innerText = '已封存';
            statusEl.className = 'text-xs font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600';
        }
        document.getElementById('desktop-case-meta').innerText = `開始：${formatDesktopDate(c.started_at)}｜紀錄員編：${c.recorder_staff_no || '未填'}${c.ended_at ? `｜結束：${formatDesktopDate(c.ended_at)}`:''}`;
        document.getElementById('desktop-case-duration').dataset.caseId = c.id;
        document.getElementById('desktop-case-duration').innerText = formatDesktopCaseDuration(c);
        renderDesktopTimeline();
        renderDesktopSummaries();
        if(!silent) renderDesktopCaseLists(desktopCases.filter(x=>x.status==='active'), desktopCases.filter(x=>x.status==='closed'), {});
    } catch(err) {
        console.error('讀取 CPR 詳細資料失敗', err);
    }
}

function setDesktopFilter(name) {
    desktopFilter = name;
    document.querySelectorAll('.desktop-filter').forEach(btn => {
        btn.classList.toggle('filter-active', btn.dataset.filter === name);
        btn.classList.toggle('filter-inactive', btn.dataset.filter !== name);
    });
    renderDesktopTimeline();
}

function desktopEventMatches(e) {
    if(desktopFilter === '全部') return true;
    if(desktopFilter === '給藥') return e.action === '給藥' || e.action === '大量點滴';
    if(desktopFilter === '心律') return e.action.includes('心律') || e.action === '電擊';
    if(desktopFilter === '管路') return e.action === '管路';
    if(desktopFilter === '血品') return e.action === '血品';
    if(desktopFilter === '生命徵象') return e.action === '生命徵象';
    if(desktopFilter === '系統') return e.action.includes('系統') || e.action === '備註' || e.action === '循環評估';
    return true;
}

function renderDesktopTimeline() {
    const el = document.getElementById('desktop-timeline');
    const list = desktopEvents.filter(desktopEventMatches);
    if(!list.length) {
        el.innerHTML = '<div class="text-slate-500 text-sm text-center py-10">此分類尚未有紀錄</div>';
        return;
    }
    el.innerHTML = list.map(e => {
        const tm = new Date(e.event_time).toLocaleTimeString('zh-TW', {hour12:false});
        const highlight = String(e.detail||'').includes('ROSC') || String(e.detail||'').includes('999') ? 'text-red-300 font-bold' : 'text-slate-200';
        return `<div class="bg-slate-800 border border-slate-700 rounded-xl p-3">
            <div class="flex items-start gap-3">
                <div class="font-mono text-teal-300 text-sm shrink-0 pt-0.5">${tm}</div>
                <span class="${getActionColor(e.action)} px-2 py-0.5 rounded text-[10px] font-bold shrink-0">${escapeHtml(e.action)}</span>
                <div class="${highlight} text-sm leading-relaxed break-words">${escapeHtml(e.detail || '')}</div>
            </div>
        </div>`;
    }).join('');
}

function renderDesktopSummaries() {
    const meds = {};
    const shocks = {};
    desktopEvents.forEach(e => {
        if(e.action === '給藥' || e.action === '大量點滴') {
            const p = e.payload || {};
            let name = p.medication_name, qty = Number(p.qty), unit = p.unit;
            if(!name) {
                const m = String(e.detail || '').match(/^(.+?)\s+x\s+([\d.]+)\s+(支|瓶)/);
                if(m) { name=m[1]; qty=Number(m[2]); unit=m[3]; }
            }
            if(name && Number.isFinite(qty)) {
                const key = `${name}||${unit || (String(name).includes('500ml')?'瓶':'支')}`;
                meds[key] = (meds[key] || 0) + qty;
            }
        }
        if(e.action === '電擊') {
            const key = String(e.detail || '未註明');
            shocks[key] = (shocks[key] || 0) + 1;
        }
    });
    const medEl = document.getElementById('desktop-med-summary');
    const medEntries = Object.entries(meds);
    medEl.innerHTML = medEntries.length ? medEntries.map(([key,qty]) => {
        const [name,unit] = key.split('||');
        return `<div class="flex justify-between gap-3 border-b border-slate-100 pb-2"><span class="text-slate-700">${escapeHtml(name)}</span><span class="font-extrabold text-purple-700">${qty} ${escapeHtml(unit)}</span></div>`;
    }).join('') : '<div class="text-slate-400 text-center py-5">尚無給藥紀錄</div>';

    const shockEl = document.getElementById('desktop-shock-summary');
    const shockEntries = Object.entries(shocks);
    shockEl.innerHTML = shockEntries.length ? shockEntries.map(([name,count]) => `<div class="flex justify-between gap-3 border-b border-slate-100 pb-2"><span class="text-slate-700">${escapeHtml(name)}</span><span class="font-extrabold text-red-600">${count} 次</span></div>`).join('') : '<div class="text-slate-400 text-center py-5">尚無電擊紀錄</div>';
}

function formatDesktopDate(iso) {
    if(!iso) return '--';
    return new Date(iso).toLocaleString('zh-TW', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
}

function formatDesktopCaseDuration(c) {
    let sec = 0;
    if(c.status === 'closed' && c.ended_at) {
        sec = Math.max(0, Math.floor((new Date(c.ended_at) - new Date(c.started_at))/1000));
    } else {
        const s = c.runtime_state || {};
        if(s.isTotalTimerRunning && Number(s.totalStartTimeMs) > 0) sec = Math.max(0, Math.floor((Date.now() - Number(s.totalStartTimeMs))/1000));
        else if(Number.isFinite(Number(s.totalSeconds))) sec = Number(s.totalSeconds);
        else sec = Math.max(0, Math.floor((Date.now() - new Date(c.started_at).getTime())/1000));
    }
    return formatTimeFull(sec);
}

function updateDesktopDurations() {
    if(currentAppMode !== 'desktop' || !desktopSelectedCaseId) return;
    const c = desktopCases.find(x=>x.id===desktopSelectedCaseId);
    if(c) document.getElementById('desktop-case-duration').innerText = formatDesktopCaseDuration(c);
}

function subscribeDesktopRealtime() {
    if(desktopRealtimeChannel) supabaseClient.removeChannel(desktopRealtimeChannel);
    desktopRealtimeChannel = supabaseClient.channel('cpr-desktop-' + (desktopProfile.unit_id || 'all'))
        .on('postgres_changes', {event:'*',schema:'public',table:'cpr_cases'}, () => scheduleDesktopRefresh())
        .on('postgres_changes', {event:'*',schema:'public',table:'cpr_events'}, () => scheduleDesktopRefresh())
        .subscribe(status => {
            if(status === 'SUBSCRIBED') desktopFlashLiveBadge('即時同步');
            else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') desktopFlashLiveBadge('連線異常', true);
        });
}

function scheduleDesktopRefresh() {
    clearTimeout(desktopRefreshTimer);
    desktopRefreshTimer = setTimeout(() => refreshDesktopDashboard(false), 250);
}

function desktopFlashLiveBadge(text, error=false) {
    const el = document.getElementById('desktop-live-badge');
    el.innerHTML = `<i class="fa-solid fa-circle text-[6px] mr-1"></i>${escapeHtml(text)}`;
    el.className = error ? 'text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold' : 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

// ============================================================
// V17.7：裝置設定 / 模式切換
// ============================================================
const V176_DEFAULT_MODE_KEY = 'cpr_v176_default_mode';
let v176MobileInitialized = false;
let v176DesktopInitialized = false;
let v176GlobalListenersBound = false;

function getDeviceDefaultMode() {
    const saved = localStorage.getItem(V176_DEFAULT_MODE_KEY);
    if(saved === 'mobile' || saved === 'desktop') return saved;
    return shouldUseDesktopMode() ? 'desktop' : 'mobile';
}

function deviceModeLabel(mode) {
    return mode === 'desktop' ? '後台登入' : 'CPR紀錄';
}

function updateDeviceDrawerUI() {
    const unit = localStorage.getItem(V15_DEVICE_UNIT_KEY) || deviceUnit || '';
    const defaultMode = getDeviceDefaultMode();
    const currentUnit = document.getElementById('drawer-current-unit');
    const currentMode = document.getElementById('drawer-current-mode');
    if(currentUnit) currentUnit.textContent = unit || '請選擇';
    if(currentMode) currentMode.textContent = deviceModeLabel(currentAppMode);

    document.getElementById('drawer-default-cpr')?.classList.toggle('active', defaultMode === 'mobile');
    document.getElementById('drawer-default-backend')?.classList.toggle('active', defaultMode === 'desktop');

    const switchBtn = document.getElementById('drawer-switch-mode-btn');
    if(switchBtn) {
        switchBtn.innerHTML = currentAppMode === 'desktop'
            ? '<i class="fa-solid fa-heart-pulse"></i><span>進入 CPR紀錄</span>'
            : '<i class="fa-solid fa-right-to-bracket"></i><span>進入後台</span>';
    }

    const sel = document.getElementById('drawer-unit-select');
    if(sel && unit) sel.value = unit;
}

function openDeviceDrawer() {
    const drawer = document.getElementById('device-drawer');
    const backdrop = document.getElementById('device-drawer-backdrop');
    updateDeviceDrawerUI();
    backdrop?.classList.remove('hidden');
    requestAnimationFrame(() => drawer?.classList.add('open'));
    drawer?.setAttribute('aria-hidden','false');
}

function closeDeviceDrawer() {
    const drawer = document.getElementById('device-drawer');
    const backdrop = document.getElementById('device-drawer-backdrop');
    drawer?.classList.remove('open');
    drawer?.setAttribute('aria-hidden','true');
    setTimeout(() => backdrop?.classList.add('hidden'), 220);
}

function setDeviceDefaultMode(mode) {
    if(mode !== 'mobile' && mode !== 'desktop') return;
    localStorage.setItem(V176_DEFAULT_MODE_KEY, mode);
    updateDeviceDrawerUI();
    if(typeof showToast === 'function') showToast(`此裝置預設模式已改為「${deviceModeLabel(mode)}」`);
}

function toggleDrawerUnitEditor() {
    document.getElementById('drawer-unit-editor')?.classList.toggle('hidden');
}

async function loadDrawerUnitOptions() {
    const target = document.getElementById('drawer-unit-select');
    if(!target) return;
    try {
        const { data, error } = await supabaseClient.rpc('list_active_units');
        if(error) throw error;
        const rows = Array.isArray(data) ? data : [];
        target.innerHTML = '<option value="">請選擇</option>' + rows.map(u => `<option value="${escapeHtml(u.code)}">${escapeHtml(u.code)}${u.name ? '｜'+escapeHtml(u.name) : ''}</option>`).join('');
    } catch(err) {
        target.innerHTML = '<option value="">單位讀取失敗</option>';
    }
    target.value = localStorage.getItem(V15_DEVICE_UNIT_KEY) || deviceUnit || '';
}

async function saveDrawerUnit() {
    if(currentCprId) {
        showToast('CPR進行中不可變更單位，請先停止急救或完成本次紀錄');
        return;
    }
    const select = document.getElementById('drawer-unit-select');
    const unit = select?.value || '';
    if(!unit) return showToast('請先選擇單位', true);
    deviceUnit = unit;
    localStorage.setItem(V15_DEVICE_UNIT_KEY, unit);
    updateCaseInfoBar();
    const ok = await registerCloudDevice(unit);
    updateDeviceDrawerUI();
    document.getElementById('drawer-unit-editor')?.classList.add('hidden');
    showToast(ok ? `此裝置已改為 ${unit}` : `此裝置已改為 ${unit}，目前使用本機模式`);
}

async function ensureMobileModeReady() {
    setAppMode('mobile');
    if(!v176MobileInitialized) {
        await initV16Mobile();
        v176MobileInitialized = true;
    } else {
        updateCaseInfoBar();
    }
}

async function ensureDesktopModeReady() {
    setAppMode('desktop');
    if(!v176DesktopInitialized) {
        await initV16Desktop();
        v176DesktopInitialized = true;
    } else {
        await initDesktopSession();
    }
}

async function switchDeviceModeNow() {
    closeDeviceDrawer();
    if(currentAppMode === 'desktop') await ensureMobileModeReady();
    else await ensureDesktopModeReady();
}

function bindV176GlobalListeners() {
    if(v176GlobalListenersBound) return;
    v176GlobalListenersBound = true;
    window.addEventListener('beforeunload', persistCurrentCase);
    document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'hidden') persistCurrentCase();
    });
    window.addEventListener('online', async () => {
        setCloudStatus('syncing');
        await registerCloudDevice(deviceUnit);
        await retryPendingFinalizations();
        if(currentCprId) {
            await startCloudCaseIfNeeded();
            await flushPendingEvents();
            await saveCloudRuntimeState();
        }
    });
    window.addEventListener('offline', () => setCloudStatus('offline'));
}

// ---------- 啟動 ----------
async function initV16() {
    deviceId = getOrCreateDeviceId();
    const savedUnit = localStorage.getItem(V15_DEVICE_UNIT_KEY);
    if(savedUnit) deviceUnit = savedUnit;
    else deviceUnit = '';

    await loadDrawerUnitOptions();
    bindV176GlobalListeners();

    const initialMode = getDeviceDefaultMode();
    if(initialMode === 'desktop') {
        await ensureDesktopModeReady();
    } else {
        await ensureMobileModeReady();
    }
}

setInterval(() => {
    if(currentAppMode === 'mobile') {
        persistCurrentCase();
        autoArchiveIfExpired();
        if(navigator.onLine) retryPendingFinalizations();
    } else {
        updateDesktopDurations();
    }
}, 2000);
setInterval(updateDesktopDurations, 1000);
initV16();


// ============================================================
// V17：護理長 / 管理者後台 + 臨床設定動態化
// ============================================================
var v17ClinicalConfig = null;
var v17CurrentDesktopView = 'monitor';
var v17AdminSection = 'units';
var v17UnitsCache = [];
var v17MixSolutions = [];
var v17MixVolumes = [];
var v17AdminMedAssociations = { solutions:{}, volumes:{} };
var v17AdminEditingUnit = null;
var v17NextMedicationSort = 1;
var v17NextRhythmSort = 1;
var v17NextTubeSort = 1;
var v17NextBloodSort = 1;

function getV17SettingsUnit() {
    return desktopProfile?.role === 'admin' ? v17AdminEditingUnit : desktopUnit;
}

function isV17AdminUnitEditing() {
    return desktopProfile?.role === 'admin' && !!v17AdminEditingUnit;
}


function renderV17Toggle(id, checked, label, disabled=false, extra='') {
    return `<label class="v17-toggle"><input id="${id}" type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''} ${extra}><span class="v17-toggle-track"></span><span class="v17-toggle-text">${escapeHtml(label)}</span></label>`;
}

function showV17Toast(msg, error=false, duration=3200) {
    let toast=document.getElementById('v17-desktop-toast');
    if(!toast){
        toast=document.createElement('div');
        toast.id='v17-desktop-toast';
        toast.className='v17-toast';
        toast.innerHTML='<i class="v17-toast-icon fa-solid fa-circle-check"></i><div id="v17-desktop-toast-msg" class="font-bold text-sm leading-relaxed"></div>';
        document.body.appendChild(toast);
    }
    toast.classList.toggle('error',!!error);
    const icon=toast.querySelector('.v17-toast-icon');
    if(icon) icon.className=`v17-toast-icon fa-solid ${error?'fa-triangle-exclamation':'fa-circle-check'}`;
    const msgEl=document.getElementById('v17-desktop-toast-msg');
    if(msgEl) msgEl.innerText=String(msg||'');
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer=setTimeout(()=>toast.classList.remove('show'),duration);
}

function setV17ButtonBusy(btn, busy, busyText='處理中...') {
    if(!btn) return;
    if(busy){
        if(!btn.dataset.originalHtml) btn.dataset.originalHtml=btn.innerHTML;
        btn.disabled=true;
        btn.innerHTML=`<i class="fa-solid fa-spinner fa-spin"></i>${busyText}`;
    }else{
        btn.disabled=false;
        if(btn.dataset.originalHtml){ btn.innerHTML=btn.dataset.originalHtml; delete btn.dataset.originalHtml; }
    }
}

function toggleAdminMedPumpFields(id){
    const root=document.getElementById(`admin-med-${id}`); if(!root)return;
    const on=!!root.querySelector('[data-f="has_pump"]')?.checked;
    root.querySelectorAll('[data-pump-field]').forEach(el=>el.disabled=!on);
    const block=root.querySelector('[data-pump-block]'); if(block)block.classList.toggle('v17-muted-block',!on);
}
function toggleAdminMedMixFields(id){
    const root=document.getElementById(`admin-med-${id}`); if(!root)return;
    const on=!!root.querySelector('[data-f="has_mix_ui"]')?.checked;
    root.querySelectorAll('[data-sol],[data-vol]').forEach(el=>el.disabled=!on);
    const block=root.querySelector('[data-mix-block]'); if(block)block.classList.toggle('v17-muted-block',!on);
}

// 密碼預設隱藏時顯示「閉眼」；點一下顯示密碼後改成開眼
function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if(!input || !icon) return;
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    icon.className = hidden ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
}

async function invokeV17UserAdmin(body) {
    const { data, error } = await supabaseClient.functions.invoke('cpr-user-admin', { body });
    if(error) throw error;
    if(data && data.error) throw new Error(data.error);
    return data;
}

function showHeadNurseRegister(show) {
    const loginCard=document.getElementById('desktop-login-card');
    const regCard=document.getElementById('head-nurse-register-card');
    if(!loginCard || !regCard) return;
    loginCard.classList.toggle('hidden', !!show);
    regCard.classList.toggle('hidden', !show);
    if(show) loadV17RegistrationUnits();
}

async function loadV17RegistrationUnits() {
    const sel = document.getElementById('hn-reg-unit');
    if(!sel) return;
    sel.innerHTML='<option value="">請選擇</option>';
    try {
        const { data, error } = await supabaseClient.rpc('list_active_units');
        if(error) throw error;
        sel.innerHTML = '<option value="">請選擇</option>' + (data || []).map(u => `<option value="${escapeHtml(u.code)}">${escapeHtml(u.code)}${u.name && u.name!==u.code ? '｜'+escapeHtml(u.name):''}</option>`).join('');
    } catch(err) { sel.innerHTML = '<option value="">單位讀取失敗</option>'; }
}

function setHNRegMessage(msg, ok=false) {
    const el = document.getElementById('hn-reg-message');
    el.className = `text-sm font-bold p-3 rounded-xl ${ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`;
    el.innerText = msg;
    el.classList.remove('hidden');
}

async function submitHeadNurseRegistration() {
    const employeeNo = document.getElementById('hn-reg-employee').value.trim();
    const displayName = document.getElementById('hn-reg-name').value.trim();
    const contactEmail = document.getElementById('hn-reg-email').value.trim().toLowerCase();
    const unitCode = document.getElementById('hn-reg-unit').value;
    const password = document.getElementById('hn-reg-password').value;
    const password2 = document.getElementById('hn-reg-password2').value;
    if(!/^\d{6}$/.test(employeeNo)) return setHNRegMessage('請輸入正確員編');
    if(!displayName) return setHNRegMessage('請輸入姓名');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return setHNRegMessage('請輸入正確的電子郵件');
    if(!unitCode) return setHNRegMessage('請選擇單位');
    if(password.length < 8) return setHNRegMessage('密碼至少需要 8 碼。');
    if(password !== password2) return setHNRegMessage('兩次密碼輸入不一致。');
    try {
        await invokeV17UserAdmin({ action:'register_head_nurse', username:employeeNo, displayName, employeeNo, contactEmail, unitCode, password });
        setHNRegMessage('申請已送出，請等待管理者審核。', true);
        ['hn-reg-employee','hn-reg-name','hn-reg-email','hn-reg-password','hn-reg-password2'].forEach(id => document.getElementById(id).value='');
        document.getElementById('hn-reg-unit').value='';
    } catch(err) { setHNRegMessage(err.message || '申請失敗。'); }
}

// 同一個登入框：先嘗試單位帳號，再嘗試護理長/管理者帳號
async function desktopLogin() {
    const username = document.getElementById('desktop-username').value.trim().toUpperCase();
    const password = document.getElementById('desktop-password').value;
    if(!username) return desktopSetLoginError('請輸入帳號');
    if(!password) return desktopSetLoginError('請輸入密碼');
    desktopSetLoginError('');
    const btn = document.getElementById('desktop-login-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> 登入中...';
    try {
        const attempts = [
            `${username.toLowerCase()}@unit.cpr.local`,
            `${username.toLowerCase()}@staff.cpr.local`
        ];
        let signed = false;
        for(const email of attempts) {
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if(!error) { signed = true; break; }
        }
        if(!signed) throw new Error('LOGIN_FAILED');
        await initDesktopSession();
    } catch(err) {
        console.error(err);
        desktopSetLoginError('帳號或密碼錯誤，或帳號尚未核准。');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket mr-1"></i> 登入';
    }
}

async function initDesktopSession() {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    if(!session) {
        document.getElementById('desktop-login').classList.remove('hidden');
        document.getElementById('desktop-dashboard').classList.add('hidden');
        return;
    }
    const { data: profile, error } = await supabaseClient.from('profiles').select('*').eq('user_id', session.user.id).single();
    if(error || !profile) {
        await supabaseClient.auth.signOut();
        desktopSetLoginError('找不到此帳號的系統權限。');
        return;
    }
    if(profile.approval !== 'approved') {
        await supabaseClient.auth.signOut();
        const msg = profile.approval === 'pending' ? '護理長帳號正在等待管理者審核。' : profile.approval === 'disabled' ? '此帳號已停用。' : '此帳號目前無法登入。';
        desktopSetLoginError(msg);
        return;
    }
    desktopProfile = profile;
    if(profile.unit_id) {
        const { data: unit } = await supabaseClient.from('units').select('*').eq('id', profile.unit_id).single();
        desktopUnit = unit || null;
    } else desktopUnit = null;

    document.getElementById('desktop-login').classList.add('hidden');
    document.getElementById('desktop-dashboard').classList.remove('hidden');
    const scopeName = profile.role === 'admin' ? '全院' : (desktopUnit?.code || profile.username);
    document.getElementById('desktop-title').innerText = `${scopeName} CPR 系統`;
    const roleName = profile.role === 'admin' ? '管理者' : profile.role === 'head_nurse' ? '護理長' : '單位帳號';
    document.getElementById('desktop-role-label').innerText = `${roleName}｜${profile.username}`;
    document.getElementById('desktop-history-title').innerText = profile.role === 'unit' ? '近 3 天 CPR 紀錄' : '歷史 CPR 紀錄';
    applyDesktopRoleNavigation('monitor');
    switchDesktopView('monitor');
    await refreshDesktopDashboard(false);
    subscribeDesktopRealtime();
}

function applyDesktopRoleNavigation(view = v17CurrentDesktopView) {
    const unitBtn = document.getElementById('nav-unit-settings');
    const adminBtn = document.getElementById('nav-admin');
    const monitorBtn = document.getElementById('nav-monitor');
    const role = desktopProfile?.role || '';

    // 角色按鈕顯示權限：管理者不顯示上方「單位設定」，要從管理者後台選單位進入。
    if (unitBtn) {
        const canSeeUnitButton = role === 'head_nurse';
        unitBtn.classList.toggle('hidden', !canSeeUnitButton);
        unitBtn.style.display = canSeeUnitButton ? '' : 'none';
    }
    if (adminBtn) {
        const canSeeAdminButton = role === 'admin';
        adminBtn.classList.toggle('hidden', !canSeeAdminButton);
        adminBtn.style.display = canSeeAdminButton ? '' : 'none';
    }
    if (monitorBtn) monitorBtn.style.display = '';

    const adminUnitMode = role === 'admin' && !!v17AdminEditingUnit;
    document.querySelectorAll('.desktop-main-nav').forEach(btn => {
        const active = (btn.id === 'nav-monitor' && view === 'monitor')
          || (btn.id === 'nav-unit-settings' && view === 'unit' && role === 'head_nurse')
          || (btn.id === 'nav-admin' && (view === 'admin' || (view === 'unit' && adminUnitMode)));
        // 不再覆寫整個 className，避免把 hidden 權限類別洗掉。
        btn.classList.toggle('bg-blue-600', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('bg-slate-800', !active);
        btn.classList.toggle('text-slate-200', !active);
    });
}

function switchDesktopView(view) {
    const adminUnitMode = desktopProfile?.role === 'admin' && !!v17AdminEditingUnit;
    if(view === 'unit' && !(desktopProfile?.role === 'head_nurse' || adminUnitMode)) return;
    if(view === 'admin' && desktopProfile?.role !== 'admin') return;
    v17CurrentDesktopView = view;
    const monitorPanel = document.getElementById('desktop-monitor-panel');
    const unitPanel = document.getElementById('desktop-unit-settings-panel');
    const adminPanel = document.getElementById('desktop-admin-panel');
    monitorPanel.classList.toggle('hidden', view !== 'monitor');
    unitPanel.classList.toggle('hidden', view !== 'unit');
    adminPanel.classList.toggle('hidden', view !== 'admin');
    // 確保 GitHub Pages 快取或 Tailwind class 不會造成空白面板
    monitorPanel.style.display = view === 'monitor' ? '' : 'none';
    unitPanel.style.display = view === 'unit' ? '' : 'none';
    adminPanel.style.display = view === 'admin' ? '' : 'none';
    applyDesktopRoleNavigation(view);
    if(view === 'unit') loadHeadNurseSettings();
    if(view === 'admin') {
        const root = document.getElementById('admin-section-content');
        if (root) root.innerHTML = '<div class="text-center text-slate-400 py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>讀取管理者後台...</div>';
        // 下一個畫面週期再載入，確保面板已解除 hidden / display:none。
        requestAnimationFrame(() => switchAdminSection(v17AdminSection || 'units'));
    }
}

const v177UnitSettingsState={meds:{},tubes:{},blood:{}};
function v177Norm(v){return JSON.stringify(v??null);}
function v177SetDirty(type,id){const card=document.querySelector(`[data-v177-${type}="${id}"]`);if(card)card.dataset.dirty='1';v177RefreshDirtyBadge(type);}
function v177RefreshDirtyBadge(type){const n=document.querySelectorAll(`[data-v177-${type}][data-dirty="1"]`).length;const el=document.getElementById(`v177-${type}-dirty`);if(el){el.textContent=n?`${n} 項尚未儲存`:'已全部儲存';el.className=`v177-dirty ${n?'is-dirty':''}`;}}
function v177ToggleCard(toggle,type,id){const card=document.querySelector(`[data-v177-${type}="${id}"]`);if(card)card.classList.toggle('v177-card-off',!toggle.checked);v177SetDirty(type,id);}
function v177BindDirtyTracking(){['med','tube','blood'].forEach(type=>document.querySelectorAll(`[data-v177-${type}] input, [data-v177-${type}] select, [data-v177-${type}] textarea`).forEach(el=>{if(el.dataset.v177Bound)return;el.dataset.v177Bound='1';const card=el.closest(`[data-v177-${type}]`);const id=card?.getAttribute(`data-v177-${type}`);if(!id)return;el.addEventListener('input',()=>v177SetDirty(type,id));el.addEventListener('change',()=>v177SetDirty(type,id));}));}
async function loadHeadNurseSettings() {
    const settingsUnit=getV17SettingsUnit();if(!settingsUnit)return;const adminMode=isV17AdminUnitEditing();document.getElementById('unit-settings-title').innerText=adminMode?`${settingsUnit.code} 單位設定｜管理者`:`${settingsUnit.code} 單位設定`;const root=document.getElementById('unit-settings-content');root.innerHTML='<div class="text-center text-slate-400 py-10"><i class="fa-solid fa-spinner fa-spin mr-1"></i>讀取中...</div>';
    try{const[medsR,musR,tubesR,tusR,bloodR,busR,auditR]=await Promise.all([supabaseClient.from('medications').select('*').eq('is_active',true).order('global_sort'),supabaseClient.from('medication_unit_settings').select('*').eq('unit_id',settingsUnit.id),supabaseClient.from('tube_types').select('*').eq('is_active',true).order('sort_order'),supabaseClient.from('tube_unit_settings').select('*').eq('unit_id',settingsUnit.id),supabaseClient.from('blood_products').select('*').eq('is_active',true).order('sort_order'),supabaseClient.from('blood_unit_settings').select('*').eq('unit_id',settingsUnit.id),supabaseClient.from('audit_logs').select('*').eq('unit_id',settingsUnit.id).order('created_at',{ascending:false}).limit(20)]);[medsR,musR,tubesR,tusR,bloodR,busR].forEach(r=>{if(r.error)throw r.error});const mus=Object.fromEntries((musR.data||[]).map(x=>[x.medication_id,x])),tus=Object.fromEntries((tusR.data||[]).map(x=>[x.tube_type_id,x])),bus=Object.fromEntries((busR.data||[]).map(x=>[x.blood_product_id,x]));
    const adminHeader=adminMode?`<section class="v17-card p-4 border-blue-200 bg-blue-50"><div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><div class="font-extrabold text-blue-900">${escapeHtml(settingsUnit.code)}｜${escapeHtml(settingsUnit.name||settingsUnit.code)}</div><div class="text-sm text-blue-700 mt-1">管理者目前正在編輯此單位設定；全院主檔仍請回管理者後台維護。</div></div><button onclick="adminBackFromUnitSettings()" class="v17-btn v17-btn-secondary"><i class="fa-solid fa-arrow-left"></i>返回單位管理</button></div></section>`:'';
    root.innerHTML=`${adminHeader}<section class="v17-card p-5"><h3 class="font-extrabold text-slate-800 mb-1"><i class="fa-solid fa-key text-amber-500 mr-1"></i>單位登入密碼</h3><p class="text-sm text-slate-500 mb-4">帳號固定為 <b>${escapeHtml(settingsUnit.code)}</b>，${adminMode?'管理者可重設此單位密碼。':'護理長只能修改自己單位的密碼。'}</p><div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl"><div><label class="v17-label">新密碼</label><div class="relative"><input id="unit-new-password" type="password" class="v17-input pr-12" placeholder="至少 8 碼"><button onclick="togglePasswordVisibility('unit-new-password','unit-new-password-eye')" class="absolute right-1 top-1 bottom-1 w-10 text-slate-500"><i id="unit-new-password-eye" class="fa-solid fa-eye-slash"></i></button></div></div><div><label class="v17-label">再次輸入</label><div class="relative"><input id="unit-new-password2" type="password" class="v17-input pr-12" placeholder="再次輸入"><button onclick="togglePasswordVisibility('unit-new-password2','unit-new-password2-eye')" class="absolute right-1 top-1 bottom-1 w-10 text-slate-500"><i id="unit-new-password2-eye" class="fa-solid fa-eye-slash"></i></button></div></div></div><div class="v17-actions justify-start"><button id="unit-password-save-btn" onclick="changeOwnUnitPassword(this)" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存新密碼</button></div></section>
    <section class="v17-card p-5"><div class="v177-section-head"><div><h3 class="font-extrabold text-slate-800"><i class="fa-solid fa-pills text-purple-500 mr-1"></i>藥物設定</h3><div id="v177-med-dirty" class="v177-dirty">已全部儲存</div></div><button onclick="saveAllHNMedications(this)" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存藥物設定</button></div><div class="v177-card-grid mt-3">${(medsR.data||[]).map(m=>renderHNMedCard(m,mus[m.id]||{})).join('')}</div></section>
    <section class="v17-card p-5"><div class="v177-section-head"><div><h3 class="font-extrabold text-slate-800"><i class="fa-solid fa-syringe text-teal-500 mr-1"></i>管路預設</h3><div id="v177-tube-dirty" class="v177-dirty">已全部儲存</div></div><button onclick="saveAllHNTubes(this)" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存管路設定</button></div><div class="v177-card-grid mt-3">${(tubesR.data||[]).map(t=>renderHNTubeCard(t,tus[t.id]||{})).join('')}</div></section>
    <section class="v17-card p-5"><div class="v177-section-head"><div><h3 class="font-extrabold text-slate-800"><i class="fa-solid fa-droplet text-red-500 mr-1"></i>血品預設</h3><div id="v177-blood-dirty" class="v177-dirty">已全部儲存</div></div><button onclick="saveAllHNBlood(this)" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存血品設定</button></div><div class="v177-card-grid mt-3">${(bloodR.data||[]).map(b=>renderHNBloodCard(b,bus[b.id]||{})).join('')}</div></section>
    <section class="v17-card p-5"><h3 class="font-extrabold text-slate-800 mb-3"><i class="fa-solid fa-clock-rotate-left text-slate-500 mr-1"></i>最近設定紀錄</h3><div id="unit-audit-list">${renderAuditList(auditR.data||[])}</div></section>`;v177BindDirtyTracking();}catch(err){console.error(err);root.innerHTML=`<div class="bg-red-50 text-red-700 p-4 rounded-xl font-bold">讀取單位設定失敗：${escapeHtml(err.message||'')}</div>`;}
}
function renderHNMedCard(m,s={}){const epi=m.system_key==='epinephrine',visible=epi||s.is_visible!==false,quick=Array.isArray(s.quick_qty)?s.quick_qty.join(','):'1',globalPump=m.pump_default_value??0,hasOverride=s.pump_default_value_override!=null,pumpValue=hasOverride?s.pump_default_value_override:globalPump,sortValue=epi?1:(s.sort_order??m.global_sort??100),adminMode=isV17AdminUnitEditing();return `<div class="v17-subcard ${visible?'':'v177-card-off'}" data-v177-med="${m.id}" data-dirty="0"><div class="v17-status-line"><div><div class="flex items-center gap-2 flex-wrap"><span class="v17-sort-badge">${sortValue}</span><div class="font-extrabold text-slate-800">${escapeHtml(m.name)}</div>${epi?'<span class="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">固定第一</span>':''}</div><div class="text-xs text-slate-400 mt-1">${escapeHtml(m.generic_name||'')}${m.has_pump?`｜Pump ${m.pump_min_qty}支以上`:''}</div>${adminMode?`<div class="text-[11px] text-blue-600 mt-1">全院預設：${m.default_qty??1} 支${m.has_pump?`｜Pump ${globalPump} ${escapeHtml(m.pump_unit||'')}`:''}</div>`:''}</div>${renderV17Toggle(`hn-med-visible-${m.id}`,visible,'顯示',epi,epi?'':`onchange="v177ToggleCard(this,'med','${m.id}')"`)}</div><div class="v17-form-grid mt-3"><div class="v17-field"><label class="v17-label">預設支數</label><input id="hn-med-qty-${m.id}" type="number" step="0.5" class="v17-input" value="${s.default_qty??m.default_qty??1}"></div><div class="v17-field"><label class="v17-label">快速選擇（逗號分隔）</label><input id="hn-med-quick-${m.id}" class="v17-input" value="${escapeHtml(quick)}" placeholder="1,2,6"></div><div class="v17-field"><label class="v17-label">排序</label><input id="hn-med-sort-${m.id}" type="number" class="v17-input" value="${sortValue}" ${epi?'disabled':''}></div>${m.has_pump?`<div class="v17-field"><label class="v17-label">Pump 預設值（${escapeHtml(m.pump_unit||'滴/分')}）</label><input id="hn-med-pump-${m.id}" data-pump-mode="${hasOverride?'override':'global'}" type="number" step="0.1" class="v17-input" value="${pumpValue}"><button type="button" onclick="v177UseGlobalPump('${m.id}',${Number(globalPump)||0})" class="v177-inline-link">使用全院預設 ${globalPump}</button></div>`:''}</div>${visible?'':'<div class="v177-off-note">目前不在 CPR 畫面顯示</div>'}</div>`;}
function v177UseGlobalPump(id,val){const el=document.getElementById(`hn-med-pump-${id}`);if(!el)return;el.value=val;el.dataset.pumpMode='global';v177SetDirty('med',id);}
async function saveAllHNMedications(btn){const unit=getV17SettingsUnit();if(!unit)return alertV17('找不到目前單位',true);const cards=[...document.querySelectorAll('[data-v177-med][data-dirty="1"]')];if(!cards.length)return alertV17('藥物設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const card of cards){const id=card.dataset.v177Med,pump=document.getElementById(`hn-med-pump-${id}`),quick=document.getElementById(`hn-med-quick-${id}`).value.split(',').map(x=>Number(x.trim())).filter(x=>Number.isFinite(x)&&x>0),payload={unit_id:unit.id,medication_id:id,is_visible:document.getElementById(`hn-med-visible-${id}`).checked,default_qty:Number(document.getElementById(`hn-med-qty-${id}`).value)||1,quick_qty:quick.length?quick:[1],sort_order:Number(document.getElementById(`hn-med-sort-${id}`).value)||100,pump_default_value_override:pump?(pump.dataset.pumpMode==='global'?null:(Number(pump.value)||0)):null};const{error}=await supabaseClient.from('medication_unit_settings').upsert(payload,{onConflict:'unit_id,medication_id'});if(error)throw error;}alertV17(`藥物設定已更新，共 ${cards.length} 項`);await loadHeadNurseSettings();}catch(e){alertV17(`儲存失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}}
function renderHNTubeCard(t,s={}){const defs=s.default_values||{},fields=Array.isArray(t.field_schema)?t.field_schema:[],sort=s.sort_order??t.sort_order??100,visible=s.is_visible!==false;return `<div class="v17-subcard ${visible?'':'v177-card-off'}" data-v177-tube="${t.id}" data-dirty="0"><div class="v17-status-line"><div class="flex items-center gap-2"><span class="v17-sort-badge">${sort}</span><div class="font-extrabold">${escapeHtml(t.name)}</div></div>${renderV17Toggle(`hn-tube-visible-${t.id}`,visible,'顯示',false,`onchange="v177ToggleCard(this,'tube','${t.id}')"`)}</div><div class="v17-form-grid mt-3"><div class="v17-field"><label class="v17-label">排序</label><input id="hn-tube-sort-${t.id}" type="number" class="v17-input" value="${sort}"></div>${fields.map(f=>`<div class="v17-field"><label class="v17-label">${escapeHtml(f.label||f.key)} 預設</label><input id="hn-tube-def-${t.id}-${escapeHtml(f.key)}" data-field-key="${escapeHtml(f.key)}" class="v17-input" value="${escapeHtml(defs[f.key]??f.default??'')}"></div>`).join('')}</div>${visible?'':'<div class="v177-off-note">目前不在 CPR 畫面顯示</div>'}</div>`;}
async function saveAllHNTubes(btn){const unit=getV17SettingsUnit();if(!unit)return alertV17('找不到目前單位',true);const cards=[...document.querySelectorAll('[data-v177-tube][data-dirty="1"]')];if(!cards.length)return alertV17('管路設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const card of cards){const id=card.dataset.v177Tube,defs={};card.querySelectorAll('[data-field-key]').forEach(el=>{if(el.value!=='')defs[el.dataset.fieldKey]=el.value});const payload={unit_id:unit.id,tube_type_id:id,is_visible:document.getElementById(`hn-tube-visible-${id}`).checked,sort_order:Number(document.getElementById(`hn-tube-sort-${id}`).value)||100,default_values:defs};const{error}=await supabaseClient.from('tube_unit_settings').upsert(payload,{onConflict:'unit_id,tube_type_id'});if(error)throw error;}alertV17(`管路設定已更新，共 ${cards.length} 項`);await loadHeadNurseSettings();}catch(e){alertV17(`儲存失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}}
function renderHNBloodCard(b,s={}){const sort=s.sort_order??b.sort_order??100,visible=s.is_visible!==false;return `<div class="v17-subcard ${visible?'':'v177-card-off'}" data-v177-blood="${b.id}" data-dirty="0"><div class="v17-status-line"><div class="flex items-center gap-2"><span class="v17-sort-badge">${sort}</span><div class="font-extrabold">${escapeHtml(b.name)}</div></div>${renderV17Toggle(`hn-blood-visible-${b.id}`,visible,'顯示',false,`onchange="v177ToggleCard(this,'blood','${b.id}')"`)}</div><div class="v17-form-grid mt-3"><div class="v17-field"><label class="v17-label">預設 U</label><input id="hn-blood-u-${b.id}" type="number" step="0.5" class="v17-input" value="${s.default_units??2}"></div><div class="v17-field"><label class="v17-label">排序</label><input id="hn-blood-sort-${b.id}" type="number" class="v17-input" value="${sort}"></div></div>${visible?'':'<div class="v177-off-note">目前不在 CPR 畫面顯示</div>'}</div>`;}
async function saveAllHNBlood(btn){const unit=getV17SettingsUnit();if(!unit)return alertV17('找不到目前單位',true);const cards=[...document.querySelectorAll('[data-v177-blood][data-dirty="1"]')];if(!cards.length)return alertV17('血品設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const card of cards){const id=card.dataset.v177Blood,payload={unit_id:unit.id,blood_product_id:id,is_visible:document.getElementById(`hn-blood-visible-${id}`).checked,default_units:Number(document.getElementById(`hn-blood-u-${id}`).value)||1,sort_order:Number(document.getElementById(`hn-blood-sort-${id}`).value)||100};const{error}=await supabaseClient.from('blood_unit_settings').upsert(payload,{onConflict:'unit_id,blood_product_id'});if(error)throw error;}alertV17(`血品設定已更新，共 ${cards.length} 項`);await loadHeadNurseSettings();}catch(e){alertV17(`儲存失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}}

async function changeOwnUnitPassword(btn){
    const settingsUnit=getV17SettingsUnit(); if(!settingsUnit)return alertV17('找不到目前單位',true);
    const p=document.getElementById('unit-new-password').value,p2=document.getElementById('unit-new-password2').value;
    if(p.length<8)return alertV17('密碼至少 8 碼',true);
    if(p!==p2)return alertV17('兩次密碼不一致',true);
    setV17ButtonBusy(btn,true,'更新中...');
    try{
        const result=await invokeV17UserAdmin({action:'reset_unit_password',unitId:settingsUnit.id,password:p});
        document.getElementById('unit-new-password').value=''; document.getElementById('unit-new-password2').value='';
        alertV17(`${settingsUnit.code} 單位密碼已更新`);
        return result;
    }catch(e){
        console.error('reset unit password failed',e);
        alertV17(`密碼更新失敗：${e?.message||String(e)}`,true);
    }finally{ setV17ButtonBusy(btn,false); }
}

function alertV17(msg,error=false){
    desktopFlashLiveBadge(error?'操作失敗':'已儲存',error);
    const el=document.getElementById('desktop-last-sync'); if(el)el.innerText=msg;
    showV17Toast(msg,error);
}
function v177ActionLabel(x){const op=String(x.action||'').split(' ')[0],type=x.target_type||'';const opMap={INSERT:'新增',UPDATE:'修改',DELETE:'刪除'},typeMap={medication_unit_settings:'藥物設定',tube_unit_settings:'管路設定',blood_unit_settings:'血品設定',unit_settings:'單位設定',medications:'全院藥物',rhythms:'心律設定',tube_types:'管路主檔',blood_products:'血品主檔',profiles:'帳號設定',units:'單位設定'};return `${opMap[op]||'調整'}${typeMap[type]||'系統設定'}`;}
function v177ValueText(v){if(v===true)return '開啟';if(v===false)return '關閉';if(v==null)return '未設定';if(Array.isArray(v))return v.join('、');if(typeof v==='object')return '已更新';return String(v);}
function v177AuditChanges(x){const old=x.old_value||{},neu=x.new_value||{},labels={is_visible:'顯示狀態',default_qty:'預設支數',quick_qty:'快速選擇',sort_order:'排序',pump_default_value_override:'Pump預設值',default_units:'預設數量',default_values:'預設內容',is_active:'啟用狀態',name:'名稱',approval:'帳號狀態'};const rows=[];for(const k of Object.keys({...old,...neu})){if(['id','unit_id','medication_id','tube_type_id','blood_product_id','created_at','updated_at','user_id'].includes(k))continue;if(v177Norm(old[k])===v177Norm(neu[k]))continue;rows.push(`${labels[k]||k}：${escapeHtml(v177ValueText(old[k]))} → ${escapeHtml(v177ValueText(neu[k]))}`)}return rows.slice(0,5);}
function renderAuditList(list){if(!list.length)return '<div class="text-sm text-slate-400 py-4">尚無設定紀錄</div>';return `<div class="space-y-2">${list.map(x=>{const changes=v177AuditChanges(x);return `<div class="v177-audit-item"><div class="font-bold text-slate-700">${escapeHtml(x.actor_username||'系統')}｜${escapeHtml(v177ActionLabel(x))}</div>${changes.length?`<div class="text-xs text-slate-600 mt-1 space-y-0.5">${changes.map(c=>`<div>${c}</div>`).join('')}</div>`:''}<div class="text-xs text-slate-400 mt-1">${formatDesktopDate(x.created_at)}</div></div>`}).join('')}</div>`;}

function switchAdminSection(section){
    if(desktopProfile?.role!=='admin') return;
    v17AdminSection=section;
    const root=adminRoot();
    if(!root){ console.error('V2 admin-section-content not found'); return; }
    document.querySelectorAll('.admin-section-btn').forEach(b=>{
        const active=b.dataset.adminSection===section;
        b.className=`admin-section-btn px-4 py-2 rounded-lg font-bold text-sm ${active?'bg-blue-600 text-white':'bg-slate-100 text-slate-700'}`;
    });
    try {
        let task;
        if(section==='units') task=loadAdminUnits();
        else if(section==='headnurses') task=loadAdminHeadNurses();
        else if(section==='medications') task=loadAdminMedications();
        else if(section==='rhythms') task=loadAdminRhythms();
        else if(section==='tubes') task=loadAdminTubesBlood();
        else if(section==='audit') task=loadAdminAudit();
        else task=loadAdminUnits();
        Promise.resolve(task).catch(err=>{
            console.error('V2 admin load error',err);
            root.innerHTML=`<div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl font-bold">管理者後台讀取失敗：${escapeHtml(err?.message||String(err))}</div>`;
        });
    } catch(err) {
        console.error('V2 admin switch error',err);
        root.innerHTML=`<div class="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl font-bold">管理者後台讀取失敗：${escapeHtml(err?.message||String(err))}</div>`;
    }
}
function adminRoot(){return document.getElementById('admin-section-content');}

async function loadAdminUnits(){
    const root=adminRoot();
    root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';
    const {data,error}=await supabaseClient.from('units').select('*').order('sort_order').order('code');
    if(error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(error.message)}</div>`;
    v17UnitsCache=data||[];
    root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">新增使用單位</h2><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">單位代碼 / 帳號</label><input id="admin-unit-code" class="v17-input uppercase" placeholder="例如：8A"></div><div class="v17-field"><label class="v17-label">單位名稱</label><input id="admin-unit-name" class="v17-input" placeholder="例如：8A病房"></div><div class="v17-field"><label class="v17-label">初始密碼</label><div class="relative"><input id="admin-unit-password" type="password" class="v17-input pr-12" placeholder="至少8碼"><button onclick="togglePasswordVisibility('admin-unit-password','admin-unit-password-eye')" class="absolute right-1 top-1 bottom-1 w-10 text-slate-500"><i id="admin-unit-password-eye" class="fa-solid fa-eye-slash"></i></button></div></div><div class="v17-field"><button onclick="adminCreateUnit()" class="v17-btn v17-btn-primary w-full"><i class="fa-solid fa-plus"></i>新增單位</button></div></div><p class="v17-section-note">帳號建立後固定為單位代碼；護理長只能改密碼。管理者可進入任一單位查看與修改單位層設定。</p></section>
    <section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">目前單位</h2><div class="space-y-2">${(data||[]).map(u=>`<div class="v17-subcard v17-status-line"><div><b>${escapeHtml(u.code)}</b><span class="text-slate-500 ml-2">${escapeHtml(u.name)}</span><div class="text-xs text-slate-400 mt-1">登入帳號固定：${escapeHtml(u.code)}</div></div><div class="flex items-center gap-3 flex-wrap"><button onclick="adminOpenUnitSettings('${u.id}')" class="v17-btn v17-btn-primary"><i class="fa-solid fa-sliders"></i>查看 / 設定</button>${renderV17Toggle(`admin-unit-active-${u.id}`,u.is_active,'啟用',false,`onchange="adminToggleUnit('${u.id}',this.checked)"`)}</div></div>`).join('')}</div></section>`;
}

function adminOpenUnitSettings(unitId){
    if(desktopProfile?.role!=='admin') return;
    const unit=v17UnitsCache.find(u=>u.id===unitId);
    if(!unit) return alertV17('找不到此單位',true);
    v17AdminEditingUnit=unit;
    switchDesktopView('unit');
}

function adminBackFromUnitSettings(){
    v17AdminEditingUnit=null;
    v17AdminSection='units';
    switchDesktopView('admin');
}

async function adminCreateUnit(){const code=document.getElementById('admin-unit-code').value.trim().toUpperCase(),name=document.getElementById('admin-unit-name').value.trim()||code,p=document.getElementById('admin-unit-password').value;if(!code)return alertV17('請輸入單位代碼',true);if(p.length<8)return alertV17('初始密碼至少8碼',true);try{await invokeV17UserAdmin({action:'create_unit',unitCode:code,unitName:name,password:p});alertV17(`${code} 已建立`);loadAdminUnits();}catch(e){alertV17(e.message,true);}}
async function adminToggleUnit(id,isActive){const{error}=await supabaseClient.from('units').update({is_active:isActive,updated_at:new Date().toISOString()}).eq('id',id);if(error)return alertV17(error.message,true);loadAdminUnits();}

async function loadAdminHeadNurses(){const root=adminRoot();root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';const [pr,ur]=await Promise.all([supabaseClient.from('profiles').select('*').eq('role','head_nurse').order('created_at',{ascending:false}),supabaseClient.from('units').select('id,code,name')]);if(pr.error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(pr.error.message)}</div>`;const um=Object.fromEntries((ur.data||[]).map(u=>[u.id,u]));root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">護理長帳號申請與權限</h2><div class="space-y-3">${(pr.data||[]).length?(pr.data||[]).map(p=>`<div class="border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-4"><div><div class="font-extrabold">${escapeHtml(p.display_name||p.username)} <span class="text-xs text-slate-400">${escapeHtml(p.username)}</span></div><div class="text-sm text-slate-500">${escapeHtml(um[p.unit_id]?.code||'--')}｜員編 ${escapeHtml(p.employee_no||p.username||'--')}｜${p.contact_email?escapeHtml(p.contact_email)+'｜':''}狀態 ${escapeHtml(p.approval)}</div></div><div class="flex gap-2 flex-wrap justify-end">${p.approval!=='approved'?`<button onclick="adminSetHNApproval('${p.user_id}','approved')" class="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold">核准</button>`:''}${p.approval==='approved'?`<button onclick="adminSetHNApproval('${p.user_id}','disabled')" class="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-bold">取消護理長權限</button>`:`<button onclick="adminSetHNApproval('${p.user_id}','disabled')" class="px-3 py-2 bg-slate-500 text-white rounded-lg text-sm font-bold">停用</button>`}<button onclick="adminDeleteHeadNurse('${p.user_id}')" class="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-bold">刪除帳號</button></div></div>`).join(''):'<div class="text-slate-400 py-6 text-center">目前沒有護理長申請</div>'}</div></section>`;}
async function adminSetHNApproval(userId,status){const{error}=await supabaseClient.from('profiles').update({approval:status,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('role','head_nurse');if(error)return alertV17(error.message,true);alertV17('權限已更新');loadAdminHeadNurses();}
function adminDeleteHeadNurse(userId){showActionToast({title:'刪除護理長帳號',message:'確定要刪除這個護理長帳號嗎？刪除後需重新申請才能使用。',leftText:'取消',rightText:'確認刪除',danger:true,rightAction:async()=>{try{await invokeV17UserAdmin({action:'delete_head_nurse',userId});alertV17('帳號已刪除');loadAdminHeadNurses();}catch(e){alertV17(e.message,true);}}});}

async function loadAdminMedications(){
    const root=adminRoot(); root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';
    const [mr,sr,vr,msr,mvr]=await Promise.all([
        supabaseClient.from('medications').select('*').order('global_sort').order('name'),
        supabaseClient.from('mix_solutions').select('*').order('sort_order'),
        supabaseClient.from('mix_volumes').select('*').order('sort_order'),
        supabaseClient.from('medication_mix_solutions').select('*'),
        supabaseClient.from('medication_mix_volumes').select('*')
    ]);
    if(mr.error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(mr.error.message)}</div>`;
    const meds=mr.data||[]; v17NextMedicationSort=(meds.reduce((m,x)=>Math.max(m,Number(x.global_sort)||0),0)||0)+1;
    v17MixSolutions=sr.data||[]; v17MixVolumes=vr.data||[];
    v17AdminMedAssociations.solutions={}; (msr.data||[]).forEach(x=>(v17AdminMedAssociations.solutions[x.medication_id]??=[]).push(x.solution_id));
    v17AdminMedAssociations.volumes={}; (mvr.data||[]).forEach(x=>(v17AdminMedAssociations.volumes[x.medication_id]??=[]).push(x.volume_id));
    root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">泡製選項</h2><div class="v17-form-grid v17-grid-2"><div class="v17-field"><label class="v17-label">泡製溶液</label><div class="flex gap-2"><input id="admin-new-solution" class="v17-input" placeholder="例如：N/S"><button onclick="adminAddSolution()" class="v17-btn v17-btn-primary"><i class="fa-solid fa-plus"></i>新增</button></div><div class="v17-option-row mt-2">${v17MixSolutions.map(x=>`<span class="v17-check">${escapeHtml(x.name)}</span>`).join('')||'<span class="text-sm text-slate-400">尚無</span>'}</div></div><div class="v17-field"><label class="v17-label">容量 (mL)</label><div class="flex gap-2"><input id="admin-new-volume" type="number" class="v17-input" placeholder="例如：250"><button onclick="adminAddVolume()" class="v17-btn v17-btn-primary"><i class="fa-solid fa-plus"></i>新增</button></div><div class="v17-option-row mt-2">${v17MixVolumes.map(x=>`<span class="v17-check">${escapeHtml(x.volume_ml)} mL</span>`).join('')||'<span class="text-sm text-slate-400">尚無</span>'}</div></div></div></section><section class="v17-card p-5"><div class="v17-status-line"><div><h2 class="font-extrabold text-lg">新增藥物</h2><p class="v17-section-note">排序已自動帶入目前下一順位：${v17NextMedicationSort}</p></div></div>${adminMedicationEditor(null)}</section><section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">藥物主檔</h2><div class="space-y-3">${meds.map(m=>`<details class="border border-slate-200 rounded-xl overflow-hidden"><summary class="cursor-pointer p-4 font-extrabold flex items-center gap-2"><span class="v17-sort-badge">${m.global_sort??100}</span><span>${escapeHtml(m.name)}</span>${m.system_key==='epinephrine'?'<span class="text-xs text-red-600">Adrenalin 固定第一</span>':''}</summary><div class="p-4 pt-0">${adminMedicationEditor(m)}</div></details>`).join('')}</div></section>`;
}

function adminMedicationEditor(m){
    const id=m?.id||'new', assocS=v17AdminMedAssociations.solutions[m?.id]||[], assocV=v17AdminMedAssociations.volumes[m?.id]||[];
    const sortValue=m?.global_sort??v17NextMedicationSort;
    const hasPump=!!m?.has_pump;
    const hasMix=assocS.length>0||assocV.length>0;
    return `<div id="admin-med-${id}">
      <div class="v17-editor-section"><div class="v17-editor-title"><i class="fa-solid fa-capsules text-blue-500"></i>基本資料</div><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">藥物名稱</label><input data-f="name" class="v17-input" value="${escapeHtml(m?.name||'')}" ${m?.system_key==='epinephrine'?'disabled':''}></div><div class="v17-field"><label class="v17-label">學名</label><input data-f="generic_name" class="v17-input" value="${escapeHtml(m?.generic_name||'')}"></div><div class="v17-field"><label class="v17-label">每支含量</label><input data-f="amount_value" type="number" step="0.1" class="v17-input" value="${m?.amount_value??''}"></div><div class="v17-field"><label class="v17-label">含量單位</label><input data-f="amount_unit" class="v17-input" value="${escapeHtml(m?.amount_unit||'mg')}"></div><div class="v17-field"><label class="v17-label">每支容量 mL</label><input data-f="volume_ml" type="number" step="0.1" class="v17-input" value="${m?.volume_ml??''}"></div><div class="v17-field"><label class="v17-label">全院預設支數</label><input data-f="default_qty" type="number" step="0.5" class="v17-input" value="${m?.default_qty??1}"></div><div class="v17-field"><label class="v17-label">排序</label><input data-f="global_sort" type="number" class="v17-input" value="${sortValue}" ${m?.system_key==='epinephrine'?'disabled':''}></div></div></div>
      <div class="v17-editor-section"><div class="v17-editor-title"><i class="fa-solid fa-toggle-on text-emerald-500"></i>使用設定</div><div class="v17-option-row">${renderV17Toggle(`admin-med-active-${id}`,m?.is_active!==false,'啟用此藥物',m?.system_key==='epinephrine','data-f="is_active"')}${renderV17Toggle(`admin-med-pump-${id}`,hasPump,'使用 Pump',false,`data-f="has_pump" onchange="toggleAdminMedPumpFields('${id}')"`)}${renderV17Toggle(`admin-med-mix-${id}`,hasMix,'需要泡製',false,`data-f="has_mix_ui" onchange="toggleAdminMedMixFields('${id}')"`)}</div></div>
      <div class="v17-editor-section ${hasPump?'':'v17-muted-block'}" data-pump-block><div class="v17-editor-title"><i class="fa-solid fa-pump-medical text-indigo-500"></i>Pump 設定</div><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">幾支以上出現 Pump</label><input data-f="pump_min_qty" data-pump-field type="number" step="0.5" class="v17-input" value="${m?.pump_min_qty??1}" ${hasPump?'':'disabled'}></div><div class="v17-field"><label class="v17-label">Pump 全院預設</label><input data-f="pump_default_value" data-pump-field type="number" step="0.1" class="v17-input" value="${m?.pump_default_value??''}" ${hasPump?'':'disabled'}></div><div class="v17-field"><label class="v17-label">Pump 單位</label><input data-f="pump_unit" data-pump-field class="v17-input" value="${escapeHtml(m?.pump_unit||'滴/分')}" ${hasPump?'':'disabled'}></div></div></div>
      <div class="v17-editor-section ${hasMix?'':'v17-muted-block'}" data-mix-block><div class="v17-editor-title"><i class="fa-solid fa-flask text-purple-500"></i>泡製設定</div><div class="v17-form-grid v17-grid-2"><div><label class="v17-label">允許泡製溶液</label><div class="v17-option-row">${v17MixSolutions.map(s=>`<label class="v17-check"><input data-sol="${s.id}" type="checkbox" ${assocS.includes(s.id)?'checked':''} ${hasMix?'':'disabled'}><span>${escapeHtml(s.name)}</span></label>`).join('')||'<span class="text-sm text-slate-400">尚未建立泡製溶液</span>'}</div></div><div><label class="v17-label">允許容量</label><div class="v17-option-row">${v17MixVolumes.map(v=>`<label class="v17-check"><input data-vol="${v.id}" type="checkbox" ${assocV.includes(v.id)?'checked':''} ${hasMix?'':'disabled'}><span>${escapeHtml(v.volume_ml)} mL</span></label>`).join('')||'<span class="text-sm text-slate-400">尚未建立容量</span>'}</div></div></div></div>
      <div class="v17-actions"><button onclick="saveAdminMedication('${id}',this)" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>${m?'儲存設定':'新增藥物'}</button></div>
    </div>`;
}

async function saveAdminMedication(id,btn){
    const root=document.getElementById(`admin-med-${id}`), get=f=>root.querySelector(`[data-f="${f}"]`);
    const hasPump=get('has_pump').checked;
    const payload={name:get('name').value.trim(),generic_name:get('generic_name').value.trim()||null,amount_value:Number(get('amount_value').value)||null,amount_unit:get('amount_unit').value.trim()||'mg',volume_ml:Number(get('volume_ml').value)||null,default_qty:Number(get('default_qty').value)||1,has_pump:hasPump,pump_min_qty:hasPump?(Number(get('pump_min_qty').value)||1):1,pump_default_value:hasPump?(Number(get('pump_default_value').value)||null):null,pump_unit:hasPump?(get('pump_unit').value.trim()||'滴/分'):'滴/分',is_active:get('is_active').checked,global_sort:Number(get('global_sort').value)||v17NextMedicationSort,updated_at:new Date().toISOString()};
    if(!payload.name)return alertV17('藥物名稱必填',true);
    setV17ButtonBusy(btn,true,'儲存中...');
    try{
      let medId=id;
      if(id==='new'){const{data,error}=await supabaseClient.from('medications').insert(payload).select().single();if(error)throw error;medId=data.id;}
      else{const{error}=await supabaseClient.from('medications').update(payload).eq('id',id);if(error)throw error;}
      const mixEnabled=get('has_mix_ui')?.checked;
      const sols=mixEnabled?[...root.querySelectorAll('[data-sol]:checked')].map(x=>x.dataset.sol):[];
      const vols=mixEnabled?[...root.querySelectorAll('[data-vol]:checked')].map(x=>x.dataset.vol):[];
      await supabaseClient.from('medication_mix_solutions').delete().eq('medication_id',medId);
      await supabaseClient.from('medication_mix_volumes').delete().eq('medication_id',medId);
      if(sols.length){const{error}=await supabaseClient.from('medication_mix_solutions').insert(sols.map(solution_id=>({medication_id:medId,solution_id})));if(error)throw error;}
      if(vols.length){const{error}=await supabaseClient.from('medication_mix_volumes').insert(vols.map(volume_id=>({medication_id:medId,volume_id})));if(error)throw error;}
      alertV17(id==='new'?`藥物 ${payload.name} 已新增`:`${payload.name} 設定已儲存`);
      await loadAdminMedications();
    }catch(e){alertV17(`儲存失敗：${e?.message||String(e)}`,true);}finally{setV17ButtonBusy(btn,false);}
}

async function adminAddSolution(){const name=document.getElementById('admin-new-solution').value.trim();if(!name)return;const{error}=await supabaseClient.from('mix_solutions').insert({name,sort_order:v17MixSolutions.length+1});if(error)return alertV17(error.message,true);loadAdminMedications();}
async function adminAddVolume(){const v=Number(document.getElementById('admin-new-volume').value);if(!v)return;const{error}=await supabaseClient.from('mix_volumes').insert({volume_ml:v,sort_order:v17MixVolumes.length+1});if(error)return alertV17(error.message,true);loadAdminMedications();}

async function loadAdminRhythms(){
    const root=adminRoot(); const[rr,sr]=await Promise.all([supabaseClient.from('rhythms').select('*').order('sort_order').order('name'),supabaseClient.from('shock_energies').select('*').order('sort_order')]);
    const rhythms=rr.data||[]; v17NextRhythmSort=(rhythms.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),0)||0)+1;
    root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">新增心律</h2><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">心律名稱</label><input id="admin-rhythm-name" class="v17-input" placeholder="例如：AF"></div><div class="v17-field"><label class="v17-label">排序</label><input id="admin-rhythm-sort" type="number" class="v17-input" value="${v17NextRhythmSort}"></div><div class="v17-field">${renderV17Toggle('admin-rhythm-shock',false,'啟動電擊')}</div><div class="v17-field"><button onclick="adminAddRhythm()" class="v17-btn v17-btn-primary w-full"><i class="fa-solid fa-plus"></i>新增心律</button></div></div></section><section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">心律</h2><div class="space-y-2">${rhythms.map(r=>`<div class="v17-subcard"><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">名稱</label><input id="rh-name-${r.id}" class="v17-input" value="${escapeHtml(r.name)}"></div><div class="v17-field"><label class="v17-label">排序</label><input id="rh-sort-${r.id}" type="number" class="v17-input" value="${r.sort_order}"></div><div class="v17-field">${renderV17Toggle(`rh-shock-${r.id}`,r.is_shockable,'啟動電擊')}</div><div class="v17-field">${renderV17Toggle(`rh-active-${r.id}`,r.is_active,'啟用')}</div></div><div class="v17-actions"><button onclick="adminSaveRhythm('${r.id}')" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存設定</button></div></div>`).join('')}</div></section><section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">電擊焦耳</h2><div class="flex gap-2 flex-wrap items-end"><div class="v17-field flex-1 min-w-[180px]"><label class="v17-label">新增焦耳</label><input id="admin-shock-j" type="number" class="v17-input" placeholder="例如：200"></div><button onclick="adminAddShock()" class="v17-btn v17-btn-danger"><i class="fa-solid fa-plus"></i>新增焦耳</button></div><div class="v17-option-row mt-3">${(sr.data||[]).map(s=>`<span class="v2-shock-chip"><span>${s.joules} J</span><button type="button" class="v2-shock-delete" onclick="adminDeleteShock('${s.id}',${Number(s.joules)})" aria-label="刪除 ${s.joules}J"><i class="fa-solid fa-trash"></i></button></span>`).join('')}</div></section>`;
}
async function adminAddRhythm(){const name=document.getElementById('admin-rhythm-name').value.trim();if(!name)return alertV17('請輸入心律名稱',true);const{error}=await supabaseClient.from('rhythms').insert({name,is_shockable:document.getElementById('admin-rhythm-shock').checked,sort_order:Number(document.getElementById('admin-rhythm-sort').value)||v17NextRhythmSort});if(error)return alertV17(error.message,true);alertV17(`${name} 已新增`);loadAdminRhythms();}
async function adminSaveRhythm(id){const{error}=await supabaseClient.from('rhythms').update({name:document.getElementById(`rh-name-${id}`).value.trim(),sort_order:Number(document.getElementById(`rh-sort-${id}`).value)||100,is_shockable:document.getElementById(`rh-shock-${id}`).checked,is_active:document.getElementById(`rh-active-${id}`).checked}).eq('id',id);if(error)return alertV17(error.message,true);alertV17('心律已儲存');}
async function adminAddShock(){const j=Number(document.getElementById('admin-shock-j').value);if(!j)return alertV17('請輸入焦耳',true);const{error}=await supabaseClient.from('shock_energies').insert({joules:j,sort_order:j});if(error)return alertV17(error.message,true);alertV17(`${j}J 已新增`);loadAdminRhythms();}
function adminDeleteShock(id,joules){showActionToast({title:'刪除電擊焦耳',message:`確定要刪除「${joules} J」選項嗎？歷史 CPR 已紀錄的電擊內容不會被刪除。`,leftText:'取消',rightText:'確認刪除',danger:true,rightAction:async()=>{try{const{error}=await supabaseClient.from('shock_energies').delete().eq('id',id);if(error)throw error;alertV17(`${joules}J 已刪除`);await loadAdminRhythms();}catch(e){alertV17(`刪除失敗：${e.message}`,true);}}});}

async function loadAdminTubesBlood(){
    const root=adminRoot(); const[tr,br]=await Promise.all([supabaseClient.from('tube_types').select('*').order('sort_order').order('name'),supabaseClient.from('blood_products').select('*').order('sort_order').order('name')]);
    const tubes=tr.data||[], blood=br.data||[];
    v17NextTubeSort=(tubes.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),0)||0)+1;
    v17NextBloodSort=(blood.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),0)||0)+1;
    root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">新增管路類別</h2><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">代碼</label><input id="admin-tube-code" class="v17-input" placeholder="例如 aline"></div><div class="v17-field"><label class="v17-label">顯示名稱</label><input id="admin-tube-name" class="v17-input" placeholder="例如 A-line"></div><div class="v17-field"><label class="v17-label">排序</label><input id="admin-tube-sort" type="number" class="v17-input" value="${v17NextTubeSort}"></div><div class="v17-field"><button onclick="adminAddTube()" class="v17-btn v17-btn-primary w-full"><i class="fa-solid fa-plus"></i>新增管路</button></div></div><p class="v17-section-note">排序會自動帶入下一順位；既有欄位結構仍可在下方進階欄位 JSON 編輯。</p></section><section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">管路主檔</h2><div class="space-y-3">${tubes.map(t=>`<details class="border rounded-xl overflow-hidden"><summary class="p-3 cursor-pointer font-extrabold flex items-center gap-2"><span class="v17-sort-badge">${t.sort_order}</span><span>${escapeHtml(t.name)}</span></summary><div class="p-3 pt-0"><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">名稱</label><input id="tube-name-${t.id}" class="v17-input" value="${escapeHtml(t.name)}"></div><div class="v17-field"><label class="v17-label">排序</label><input id="tube-sort-${t.id}" type="number" class="v17-input" value="${t.sort_order}"></div><div class="v17-field">${renderV17Toggle(`tube-active-${t.id}`,t.is_active,'啟用')}</div></div><div class="mt-3"><label class="v17-label">進階欄位 JSON</label><textarea id="tube-schema-${t.id}" class="v17-input font-mono text-xs h-28">${escapeHtml(JSON.stringify(t.field_schema||[],null,2))}</textarea></div><div class="v17-actions"><button onclick="adminSaveTube('${t.id}')" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存設定</button></div></div></details>`).join('')}</div></section><section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">血品</h2><div class="v17-form-grid mb-4"><div class="v17-field"><label class="v17-label">代碼</label><input id="admin-blood-code" class="v17-input" placeholder="例如 WB"></div><div class="v17-field"><label class="v17-label">名稱</label><input id="admin-blood-name" class="v17-input" placeholder="顯示名稱"></div><div class="v17-field"><label class="v17-label">排序</label><input id="admin-blood-sort" type="number" class="v17-input" value="${v17NextBloodSort}"></div><div class="v17-field"><button onclick="adminAddBlood()" class="v17-btn v17-btn-danger w-full"><i class="fa-solid fa-plus"></i>新增血品</button></div></div><div class="space-y-2">${blood.map(b=>`<div class="v17-subcard"><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">名稱</label><input id="blood-name-${b.id}" class="v17-input" value="${escapeHtml(b.name)}"></div><div class="v17-field"><label class="v17-label">排序</label><input id="blood-sort-${b.id}" type="number" class="v17-input" value="${b.sort_order}"></div><div class="v17-field">${renderV17Toggle(`blood-active-${b.id}`,b.is_active,'啟用')}</div></div><div class="v17-actions"><button onclick="adminSaveBlood('${b.id}')" class="v17-btn v17-btn-primary"><i class="fa-solid fa-floppy-disk"></i>儲存設定</button></div></div>`).join('')}</div></section>`;
}
async function adminAddTube(){const code=document.getElementById('admin-tube-code').value.trim().toLowerCase(),name=document.getElementById('admin-tube-name').value.trim();if(!code||!name)return alertV17('代碼與名稱必填',true);const{error}=await supabaseClient.from('tube_types').insert({code,name,sort_order:Number(document.getElementById('admin-tube-sort').value)||v17NextTubeSort,field_schema:[]});if(error)return alertV17(error.message,true);alertV17(`${name} 已新增`);loadAdminTubesBlood();}
async function adminSaveTube(id){let schema;try{schema=JSON.parse(document.getElementById(`tube-schema-${id}`).value||'[]');}catch(e){return alertV17('欄位 JSON 格式錯誤',true);}const{error}=await supabaseClient.from('tube_types').update({name:document.getElementById(`tube-name-${id}`).value.trim(),sort_order:Number(document.getElementById(`tube-sort-${id}`).value)||100,is_active:document.getElementById(`tube-active-${id}`).checked,field_schema:schema}).eq('id',id);if(error)return alertV17(error.message,true);alertV17('管路已儲存');}
async function adminAddBlood(){const code=document.getElementById('admin-blood-code').value.trim().toUpperCase(),name=document.getElementById('admin-blood-name').value.trim();if(!code||!name)return alertV17('代碼與名稱必填',true);const{error}=await supabaseClient.from('blood_products').insert({code,name,sort_order:Number(document.getElementById('admin-blood-sort').value)||v17NextBloodSort});if(error)return alertV17(error.message,true);alertV17(`${name} 已新增`);loadAdminTubesBlood();}
async function adminSaveBlood(id){const{error}=await supabaseClient.from('blood_products').update({name:document.getElementById(`blood-name-${id}`).value.trim(),sort_order:Number(document.getElementById(`blood-sort-${id}`).value)||100,is_active:document.getElementById(`blood-active-${id}`).checked}).eq('id',id);if(error)return alertV17(error.message,true);alertV17('血品已儲存');}
async function loadAdminAudit(){const root=adminRoot();const{data,error}=await supabaseClient.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(100);if(error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(error.message)}</div>`;root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">最近 100 筆設定操作</h2>${renderAuditList(data||[])}</section>`;}

// ---------- 手機：從 Supabase 載入單位臨床設定 ----------
async function loadV17ClinicalConfig(unitCode=deviceUnit) {
    try {
        const {data,error}=await supabaseClient.rpc('get_unit_clinical_config',{p_unit_code:unitCode});
        if(error) throw error;
        v17ClinicalConfig=data;
        applyV17ClinicalConfig();
    } catch(err) { console.warn('V17 臨床設定讀取失敗，沿用內建設定',err); }
}
function applyV17ClinicalConfig(){if(!v17ClinicalConfig)return;const meds=v17ClinicalConfig.medications||[];Object.keys(medDict).forEach(k=>{if(!k.startsWith('大量點滴'))delete medDict[k];});meds.forEach(m=>{medDict[m.name]={generic:m.generic_name||'',val:Number(m.amount_value)||0,unit:m.amount_unit||'mg',ml:Number(m.volume_ml)||0,quick:Array.isArray(m.quick_qty)?m.quick_qty:[],defaultQty:Number(m.default_qty)||1,hasPump:!!m.has_pump,pumpMinQty:Number(m.pump_min_qty)||1,pumpDefault:m.pump_default_value==null?'':Number(m.pump_default_value),pumpUnit:m.pump_unit||'滴/分',mixSolutions:m.mix_solutions||[],mixVolumes:m.mix_volumes||[],systemKey:m.system_key||null};});renderV17MedicationButtons(meds);renderV17Rhythms(v17ClinicalConfig.rhythms||[]);renderV17ShockEnergies(v17ClinicalConfig.shock_energies||[]);renderV17Tubes(v17ClinicalConfig.tubes||[]);renderV17Blood(v17ClinicalConfig.blood_products||[]);}
function renderV17MedicationButtons(meds){const epi=meds.find(m=>m.system_key==='epinephrine')||meds.find(m=>m.name==='Adrenalin');const epiBtn=document.querySelector('button[onclick="openMedModal(\'Adrenalin\')"]');if(epiBtn&&epi){epiBtn.setAttribute('onclick',`openMedModal(${JSON.stringify(epi.name)})`);const span=epiBtn.querySelector('div > span:first-child');if(span)span.innerText=epi.name;}const grid=document.getElementById('med-button-grid');if(!grid)return;const others=meds.filter(m=>m!==epi);grid.innerHTML=others.map((m,i)=>`<button onclick='openMedModal(${JSON.stringify(m.name)})' class="${i===others.length-1&&others.length%2===1?'col-span-2 ':''}bg-white text-slate-800 border border-slate-300 py-4 rounded-lg font-bold text-[15px] md:text-lg btn-active px-1 text-center shadow-sm">${escapeHtml(m.name)}</button>`).join('');}
function chunkArray(a,sizes){const out=[];let i=0,si=0;while(i<a.length){const n=sizes[Math.min(si,sizes.length-1)];out.push(a.slice(i,i+n));i+=n;si++;}return out;}
function rhythmBtnClass(r){if(r.is_shockable)return 'bg-red-50 text-red-700 border-red-200';if(['Asystole','PEA'].includes(r.name))return 'bg-slate-100 text-slate-700 border-slate-300';return 'bg-blue-50 text-blue-700 border-blue-200';}
function renderV17Rhythms(list){const box=document.getElementById('rhythm-buttons');if(box)box.innerHTML=chunkArray(list,[2,3,3]).map(row=>`<div class="flex gap-2">${row.map(r=>`<button onclick='logRhythm(${JSON.stringify(r.name)})' class="flex-1 border py-4 rounded-lg font-bold text-[15px] md:text-lg btn-active ${rhythmBtnClass(r)}">${escapeHtml(r.name)}</button>`).join('')}</div>`).join('');const cbox=document.getElementById('cycle-rhythm-buttons');if(cbox)cbox.innerHTML=chunkArray(list,[2,3,3]).map(row=>`<div class="flex gap-2">${row.map(r=>`<button onclick='selectCycleRhythm(${JSON.stringify(r.name)})' data-cycle-rhythm="${escapeHtml(r.name)}" class="cycle-r-btn flex-1 bg-slate-50 text-slate-500 border border-slate-200 py-2 rounded-lg font-bold text-sm btn-active">${escapeHtml(r.name)}</button>`).join('')}</div>`).join('');}
function renderV17ShockEnergies(list){const box=document.getElementById('shock-energy-buttons');if(box)box.innerHTML=list.map(s=>`<button onclick="logEvent('電擊','${Number(s.joules)} J'); resetShock();" class="bg-red-500 text-white py-3 rounded-lg font-bold text-base md:text-lg btn-active shadow-sm">${Number(s.joules)} J</button>`).join('');}
function logRhythm(rhythm){logEvent('心律',rhythm);const item=(v17ClinicalConfig?.rhythms||[]).find(x=>x.name===rhythm);if(item?.is_shockable){document.getElementById('shock-panel').classList.remove('hidden');document.getElementById('shock-panel').classList.add('fade-in');}else resetShock();}
function selectCycleRhythm(rhythm){selectedCycleRhythm=rhythm;document.querySelectorAll('.cycle-r-btn').forEach(btn=>{btn.className='cycle-r-btn flex-1 bg-slate-50 text-slate-500 border border-slate-200 py-2 rounded-lg font-bold text-sm btn-active';});const btn=[...document.querySelectorAll('.cycle-r-btn')].find(x=>x.dataset.cycleRhythm===rhythm);const noPulse=['VF','VT','PULSE VT','Asystole','PEA'].includes(rhythm);if(btn)btn.className=`cycle-r-btn flex-1 ${noPulse?'bg-red-100 text-red-700 border-red-400':'bg-blue-100 text-blue-700 border-blue-400'} border-2 py-2 rounded-lg font-bold text-sm btn-active`;setPulse(noPulse?'無脈搏':'摸到脈搏');}
function renderV17Tubes(list){const tabs=document.getElementById('tube-tabs-container'),panels=document.getElementById('tube-panels-container');if(!tabs||!panels)return;tabs.innerHTML=list.map((t,i)=>`<button onclick="switchTubeTab('${escapeHtml(t.code)}')" id="tab-${escapeHtml(t.code)}" class="tube-tab px-3 py-1.5 rounded-full ${i===0?'bg-teal-100 text-teal-800':'bg-slate-100 text-slate-600'} font-bold text-xs flex-shrink-0">${escapeHtml(t.name)}</button>`).join('');panels.innerHTML=list.map((t,i)=>`<div id="panel-${escapeHtml(t.code)}" class="tube-panel ${i?'hidden ':''}flex flex-col gap-2"><div class="grid grid-cols-2 gap-2">${(t.fields||[]).map(f=>renderDynamicTubeField(t,f)).join('')}</div><button onclick="submitDynamicTube('${escapeHtml(t.code)}')" class="bg-teal-500 text-white h-[40px] px-4 rounded font-bold text-sm btn-active">紀錄 ${escapeHtml(t.name)}</button></div>`).join('');}
function renderDynamicTubeField(t,f){const v=(t.default_values||{})[f.key]??f.default??'';if(f.type==='select')return `<div><label class="block text-[10px] text-slate-500 mb-1">${escapeHtml(f.label||f.key)}</label><select id="dyn-tube-${escapeHtml(t.code)}-${escapeHtml(f.key)}" class="w-full p-2 border border-slate-300 rounded text-sm bg-slate-50">${(f.options||[]).map(o=>`<option ${String(o)===String(v)?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select></div>`;return `<div><label class="block text-[10px] text-slate-500 mb-1">${escapeHtml(f.label||f.key)}</label><input id="dyn-tube-${escapeHtml(t.code)}-${escapeHtml(f.key)}" type="${f.type==='number'?'number':'text'}" inputmode="${f.type==='number'?'decimal':'text'}" class="w-full p-2 border border-slate-300 rounded text-sm bg-slate-50" value="${escapeHtml(v)}"></div>`;}
function switchTubeTab(target){document.querySelectorAll('.tube-tab').forEach(el=>{el.classList.remove('bg-teal-100','text-teal-800');el.classList.add('bg-slate-100','text-slate-600');});const act=document.getElementById('tab-'+target);if(act){act.classList.remove('bg-slate-100','text-slate-600');act.classList.add('bg-teal-100','text-teal-800');}document.querySelectorAll('.tube-panel').forEach(el=>el.classList.add('hidden'));document.getElementById('panel-'+target)?.classList.remove('hidden');}
function submitDynamicTube(code){const t=(v17ClinicalConfig?.tubes||[]).find(x=>x.code===code);if(!t)return;const parts=(t.fields||[]).map(f=>{const el=document.getElementById(`dyn-tube-${code}-${f.key}`);return el?.value?`${f.label||f.key}: ${el.value}`:'';}).filter(Boolean);logTube(t.name,parts.length?parts.join(', '):'已建立');}
function renderV17Blood(list){const grid=document.getElementById('blood-product-grid');if(!grid)return;grid.innerHTML=list.map(b=>`<button onclick='setBloodProd(${JSON.stringify(b.code)})' id="btn-b-${escapeHtml(b.code)}" class="blood-prod border-2 border-slate-200 py-3 rounded-lg text-sm font-bold bg-white text-slate-700 btn-active transition-colors">${escapeHtml(b.name)}</button>`).join('');}
function setBloodProd(prod){bloodProd=prod;document.querySelectorAll('.blood-prod').forEach(el=>{el.className='blood-prod border-2 border-slate-200 py-3 rounded-lg text-sm font-bold bg-white text-slate-700 btn-active transition-colors';});const act=document.getElementById('btn-b-'+prod);if(act)act.className=`blood-prod border-2 py-3 rounded-lg text-sm font-bold ${bloodColorBg} text-white btn-active transition-colors border-transparent`;const b=(v17ClinicalConfig?.blood_products||[]).find(x=>x.code===prod);if(b?.default_units!=null)document.getElementById('val-blood-u').value=b.default_units;}

function openMedModal(name){activeMedName=name;const info=medDict[name];activeMedQty=Number(info?.defaultQty)||1;prepSol=info?.mixSolutions?.[0]||'N/S';prepVol=String(info?.mixVolumes?.[0]||250);document.getElementById('med-modal-title').innerText=name;const genericEl=document.getElementById('med-modal-generic'),calcPanel=document.getElementById('med-calc-panel');if(info){genericEl.innerText=info.generic;genericEl.classList.remove('hidden');calcPanel.classList.remove('hidden');document.getElementById('med-modal-base').innerText=`1 支 = ${info.val} ${info.unit} / ${info.ml} ml`;}else{genericEl.classList.add('hidden');calcPanel.classList.add('hidden');}document.getElementById('med-modal-unit').innerText=name.includes('500ml')?'瓶':'支';const conflicts=checkIncompat(name),warn=document.getElementById('med-incompat-warning');if(conflicts.length){warn.classList.remove('hidden');document.getElementById('med-incompat-list').innerText=conflicts.join(', ');}else warn.classList.add('hidden');const qc=document.getElementById('quick-qty-container');qc.innerHTML='';(info?.quick||[]).forEach(num=>{const b=document.createElement('button');b.className='px-6 py-2 bg-slate-100 text-slate-700 font-bold text-lg rounded-lg border border-slate-300 btn-active shadow-sm';b.innerText=num;b.onclick=()=>{activeMedQty=Number(num);refreshMedUI();};qc.appendChild(b);});renderV17PrepOptions(info);refreshMedUI();showModal('modal-med');}
function renderV17PrepOptions(info){const s=document.getElementById('prep-solution-options'),v=document.getElementById('prep-volume-options');if(s)s.innerHTML=(info?.mixSolutions||[]).map(x=>`<button onclick='setPrepSol(${JSON.stringify(String(x))})' data-prep-sol="${escapeHtml(x)}" class="flex-1 py-3 rounded-lg text-base font-bold bg-white text-slate-500 border-2 border-slate-200 shadow-sm">${escapeHtml(x)}</button>`).join('');if(v)v.innerHTML=(info?.mixVolumes||[]).map(x=>`<button onclick="setPrepVol('${escapeHtml(x)}')" data-prep-vol="${escapeHtml(x)}" class="flex-1 py-3 rounded-lg text-base font-bold bg-white text-slate-500 border-2 border-slate-200 shadow-sm">${escapeHtml(x)}</button>`).join('');document.getElementById('med-pump-unit').innerText=info?.pumpUnit||'滴/分';if(info?.pumpDefault!==''&&info?.pumpDefault!=null)document.getElementById('med-pump-run').value=info.pumpDefault;}
function updatePrepUI(){const act='flex-1 py-3 rounded-lg text-base font-bold bg-blue-100 text-blue-700 border-2 border-blue-400 shadow-sm transition-all',ina='flex-1 py-3 rounded-lg text-base font-bold bg-white text-slate-500 border-2 border-slate-200 shadow-sm transition-all';document.querySelectorAll('[data-prep-sol]').forEach(b=>b.className=b.dataset.prepSol===String(prepSol)?act:ina);document.querySelectorAll('[data-prep-vol]').forEach(b=>b.className=b.dataset.prepVol===String(prepVol)?act:ina);}
function refreshMedUI(){document.getElementById('med-modal-qty').innerText=activeMedQty;const info=medDict[activeMedName];if(info){document.getElementById('med-modal-total').innerText=`總計: ${formatDose(info.val*activeMedQty)} ${info.unit} / ${formatDose(info.ml*activeMedQty)} ml`;}const prep=document.getElementById('med-prep-container'),hasMix=(info?.mixSolutions?.length||0)>0&&(info?.mixVolumes?.length||0)>0,pumpVisible=!!info?.hasPump&&activeMedQty>=Number(info.pumpMinQty||1);if(hasMix||pumpVisible){prep.classList.remove('hidden');prep.classList.add('flex');}else{prep.classList.add('hidden');prep.classList.remove('flex');}document.getElementById('prep-solution-options')?.parentElement?.classList.toggle('hidden',!hasMix);document.getElementById('prep-volume-options')?.parentElement?.classList.toggle('hidden',!hasMix);document.getElementById('med-pump-row')?.classList.toggle('hidden',!pumpVisible);updatePrepUI();}
function confirmMed(){let type=activeMedName.includes('大量點滴')?'大量點滴':'給藥',unit=activeMedName.includes('500ml')?'瓶':'支',detail=`${activeMedName} x ${activeMedQty} ${unit}`,info=medDict[activeMedName];if(info)detail+=` (${formatDose(info.val*activeMedQty)}${info.unit}/${formatDose(info.ml*activeMedQty)}ml)`;const hasMix=(info?.mixSolutions?.length||0)>0&&(info?.mixVolumes?.length||0)>0,pumpVisible=!!info?.hasPump&&activeMedQty>=Number(info.pumpMinQty||1);const pumpRun=pumpVisible?document.getElementById('med-pump-run').value:null;if(hasMix)detail+=` (加至 ${prepSol} ${prepVol}mL${pumpVisible?`, Pump run: ${pumpRun} ${info.pumpUnit||'滴/分'}`:''})`;if(info?.systemKey==='epinephrine'||activeMedName==='Adrenalin'){updateMedSummary(activeMedName,activeMedQty);const count=medSummaryDict[activeMedName];stopEpiAlarm();epiSeconds=180;epiTargetTimeMs=Date.now()+180000;const cb=document.getElementById('epi-badge-count'),tb=document.getElementById('epi-timer-badge');cb.innerText=count;cb.classList.remove('hidden');tb.innerText='03:00';tb.classList.remove('hidden','bg-red-800','bg-slate-500','timer-warning');tb.classList.add('bg-red-600');}else updateMedSummary(activeMedName,activeMedQty);const conflicts=checkIncompat(activeMedName);givenMedSet.add(activeMedName);addLocalEvent(type,detail,{kind:'medication',medication_name:activeMedName,qty:activeMedQty,unit,preparation:hasMix?{solution:prepSol,volume_ml:Number(prepVol),pump_run:pumpVisible&&pumpRun?Number(pumpRun):null,pump_unit:info?.pumpUnit||'滴/分'}:null},false);if(conflicts.length)setTimeout(()=>showToast(`⚠️ 注意：與 ${conflicts.join(', ')} 不相容<br><span class="text-[13px] text-red-200 mt-1 block">請建立另一條 IV Set (分開給藥)</span>`,true,5000),100);else showToast(`${type}已紀錄`);closeModal();}

// App 啟動後補載 V17 設定；不改 V16 CPR 核心流程
async function v17Boot(){if(currentAppMode==='mobile'){let tries=0;const t=setInterval(async()=>{tries++;if(deviceUnit){clearInterval(t);await loadV17ClinicalConfig(deviceUnit);}if(tries>20)clearInterval(t);},250);}else{loadV17RegistrationUnits();}}
setTimeout(v17Boot,400);


// V17：管理者監看全院時顯示單位代碼，歷史讀取上限提高
async function queryDesktopCases(status) {
    let q = supabaseClient.from('cpr_cases')
        .select('id,unit_id,client_case_key,bed_no,recorder_staff_no,started_at,rosc_at,ended_at,status,close_reason,runtime_state,updated_at,units(code,name)')
        .eq('status', status)
        .order('started_at', { ascending:false })
        .limit(status === 'active' ? 100 : 1000);
    if(desktopProfile.role !== 'admin' && desktopProfile.unit_id) q = q.eq('unit_id', desktopProfile.unit_id);
    if(desktopProfile.role === 'unit' && status === 'closed') q = q.gte('started_at', new Date(Date.now() - 3*24*60*60*1000).toISOString());
    const { data, error } = await q; if(error) throw error; return data || [];
}
function v17CaseUnitCode(c){ return c?.units?.code || desktopUnit?.code || 'CPR'; }
function renderDesktopCaseLists(active, history, latestMap) {
    document.getElementById('desktop-active-count').innerText = active.length;
    const activeEl = document.getElementById('desktop-active-list');
    activeEl.innerHTML = active.length ? active.map(c => { const latest=latestMap[c.id]; const unit=v17CaseUnitCode(c); return `<button onclick="openDesktopCase('${c.id}')" class="w-full text-left border rounded-xl p-3 transition ${desktopSelectedCaseId===c.id?'border-blue-500 bg-blue-50':'border-slate-200 hover:border-blue-300 bg-white'}"><div class="flex justify-between items-center gap-2"><span class="font-extrabold text-slate-900">${desktopProfile?.role==='admin'?escapeHtml(unit)+'｜':''}${escapeHtml(c.bed_no?c.bed_no+'床':'床號待補')}</span><span class="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">CPR中</span></div><div class="text-xs text-slate-500 mt-1">開始 ${formatDesktopDate(c.started_at)}</div><div class="text-sm mt-2 truncate ${latest?'text-slate-700':'text-slate-400'}">${latest?`最新：${escapeHtml(latest.action)}｜${escapeHtml(latest.detail||'')}`:'尚無處置紀錄'}</div></button>`; }).join('') : '<div class="text-sm text-slate-400 text-center py-8">目前沒有進行中的 CPR</div>';
    const histEl=document.getElementById('desktop-history-list');
    histEl.innerHTML=history.length?history.map(c=>`<button onclick="openDesktopCase('${c.id}')" class="w-full text-left border rounded-xl p-3 transition ${desktopSelectedCaseId===c.id?'border-blue-500 bg-blue-50':'border-slate-200 hover:border-blue-300 bg-white'}"><div class="flex justify-between items-center gap-2"><span class="font-extrabold text-slate-800">${desktopProfile?.role==='admin'?escapeHtml(v17CaseUnitCode(c))+'｜':''}${escapeHtml(c.bed_no?c.bed_no+'床':'床號未填')}</span><span class="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">已封存</span></div><div class="text-xs text-slate-500 mt-1">${formatDesktopDate(c.started_at)}</div><div class="text-[11px] text-slate-400 mt-1">${desktopCloseReason(c.close_reason)}</div></button>`).join(''):'<div class="text-sm text-slate-400 text-center py-8">目前沒有歷史紀錄</div>';
}
async function openDesktopCase(caseId, silent=false){desktopSelectedCaseId=caseId;const c=desktopCases.find(x=>x.id===caseId);if(!c)return;try{const{data,error}=await supabaseClient.from('cpr_events').select('*').eq('cpr_case_id',caseId).eq('is_deleted',false).order('event_time',{ascending:false});if(error)throw error;desktopEvents=data||[];document.getElementById('desktop-empty-detail').classList.add('hidden');document.getElementById('desktop-case-detail').classList.remove('hidden');document.getElementById('desktop-case-name').innerText=`${v17CaseUnitCode(c)}｜${c.bed_no?c.bed_no+'床':'床號待補'}`;const statusEl=document.getElementById('desktop-case-status');if(c.status==='active'){statusEl.innerText=c.rosc_at?'ROSC後觀察中':'CPR中';statusEl.className=c.rosc_at?'text-xs font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700':'text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700';}else{statusEl.innerText='已封存';statusEl.className='text-xs font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600';}document.getElementById('desktop-case-meta').innerText=`開始：${formatDesktopDate(c.started_at)}｜紀錄員編：${c.recorder_staff_no||'未填'}${c.ended_at?`｜結束：${formatDesktopDate(c.ended_at)}`:''}`;document.getElementById('desktop-case-duration').dataset.caseId=c.id;document.getElementById('desktop-case-duration').innerText=formatDesktopCaseDuration(c);renderDesktopTimeline();renderDesktopSummaries();if(!silent)renderDesktopCaseLists(desktopCases.filter(x=>x.status==='active'),desktopCases.filter(x=>x.status==='closed'),{});}catch(err){console.error('讀取 CPR 詳細資料失敗',err);}}

/* ============================================================
   CPRNOTE V2
   CPR 刪除治理 / 使用意見 / 滿意度 / 後台一致性
   ============================================================ */
let v18DeletionMap = {};
let v18DeleteCaseId = null;
let v18Rating = 5;
let v18RatingChanged = false;
let v18RatingContext = null;

function v18ReasonLabel(code,text=''){
    if(code==='test') return '測試資料';
    if(code==='mistake') return '資料誤植';
    return text || '其他';
}
function v18StatusLabel(status){
    return ({pending:'待審核',approved:'已核准待完成',rejected:'已拒絕',completed:'已完成',processing:'處理中',waiting_user:'等待使用者回覆'})[status] || status || '--';
}
function v18CategoryLabel(c){return ({operation:'操作問題',feature:'功能建議',system:'系統異常',other:'其他'})[c]||c;}
function v18StatusBadge(status){return `<span class="v18-status ${escapeHtml(status||'')}">${escapeHtml(v18StatusLabel(status))}</span>`;}

// ---------- V18 導覽：護理長新增使用意見頁 ----------
function applyDesktopRoleNavigation(view = v17CurrentDesktopView) {
    const role = desktopProfile?.role || '';
    const unitBtn=document.getElementById('nav-unit-settings'), adminBtn=document.getElementById('nav-admin'), monitorBtn=document.getElementById('nav-monitor'), feedbackBtn=document.getElementById('nav-feedback');
    if(unitBtn){const show=role==='head_nurse';unitBtn.classList.toggle('hidden',!show);unitBtn.style.display=show?'':'none';}
    if(feedbackBtn){const show=role==='head_nurse';feedbackBtn.classList.toggle('hidden',!show);feedbackBtn.style.display=show?'':'none';}
    if(adminBtn){const show=role==='admin';adminBtn.classList.toggle('hidden',!show);adminBtn.style.display=show?'':'none';}
    if(monitorBtn) monitorBtn.style.display='';
    const adminUnitMode=role==='admin'&&!!v17AdminEditingUnit;
    document.querySelectorAll('.desktop-main-nav').forEach(btn=>{
        const active=(btn.id==='nav-monitor'&&view==='monitor')||(btn.id==='nav-unit-settings'&&view==='unit'&&role==='head_nurse')||(btn.id==='nav-feedback'&&view==='feedback'&&role==='head_nurse')||(btn.id==='nav-admin'&&(view==='admin'||(view==='unit'&&adminUnitMode)));
        btn.classList.toggle('bg-blue-600',active);btn.classList.toggle('text-white',active);btn.classList.toggle('bg-slate-800',!active);btn.classList.toggle('text-slate-200',!active);
    });
}
function switchDesktopView(view){
    const adminUnitMode=desktopProfile?.role==='admin'&&!!v17AdminEditingUnit;
    if(view==='unit'&&!(desktopProfile?.role==='head_nurse'||adminUnitMode))return;
    if(view==='feedback'&&desktopProfile?.role!=='head_nurse')return;
    if(view==='admin'&&desktopProfile?.role!=='admin')return;
    v17CurrentDesktopView=view;
    const ids={monitor:'desktop-monitor-panel',unit:'desktop-unit-settings-panel',feedback:'desktop-feedback-panel',admin:'desktop-admin-panel'};
    Object.entries(ids).forEach(([k,id])=>{const el=document.getElementById(id);if(!el)return;const show=k===view;el.classList.toggle('hidden',!show);el.style.display=show?'':'none';});
    applyDesktopRoleNavigation(view);
    if(view==='unit')loadHeadNurseSettings();
    if(view==='feedback')loadHeadNurseFeedback();
    if(view==='admin')requestAnimationFrame(()=>switchAdminSection(v17AdminSection||'units'));
}

// ---------- V18 歷史 CPR：排除完成刪除資料 + 護理長刪除申請 ----------
async function queryDesktopCases(status){
    let q=supabaseClient.from('cpr_cases').select('id,unit_id,client_case_key,bed_no,recorder_staff_no,started_at,rosc_at,ended_at,status,close_reason,runtime_state,updated_at,soft_deleted,units(code,name)').eq('status',status).eq('soft_deleted',false).order('started_at',{ascending:false}).limit(status==='active'?100:1000);
    if(desktopProfile.role!=='admin'&&desktopProfile.unit_id)q=q.eq('unit_id',desktopProfile.unit_id);
    if(desktopProfile.role==='unit'&&status==='closed')q=q.gte('started_at',new Date(Date.now()-3*24*60*60*1000).toISOString());
    const{data,error}=await q;if(error)throw error;return data||[];
}
async function refreshDesktopDashboard(showFeedback=false){
    if(!desktopProfile)return;
    try{
        const[active,history]=await Promise.all([queryDesktopCases('active'),queryDesktopCases('closed')]);
        desktopCases=[...active,...history];let latestMap={};
        if(active.length){const{data:evs}=await supabaseClient.from('cpr_events').select('cpr_case_id,event_time,action,detail').in('cpr_case_id',active.map(x=>x.id)).eq('is_deleted',false).order('event_time',{ascending:false});(evs||[]).forEach(e=>{if(!latestMap[e.cpr_case_id])latestMap[e.cpr_case_id]=e;});}
        v18DeletionMap={};
        if(desktopProfile.role==='head_nurse'&&history.length){const{data:reqs}=await supabaseClient.from('cpr_deletion_requests').select('*').in('cpr_case_id',history.map(x=>x.id)).order('created_at',{ascending:false});(reqs||[]).forEach(r=>{if(!v18DeletionMap[r.cpr_case_id])v18DeletionMap[r.cpr_case_id]=r;});}
        renderDesktopCaseLists(active,history,latestMap);
        if(desktopSelectedCaseId&&desktopCases.some(x=>x.id===desktopSelectedCaseId))await openDesktopCase(desktopSelectedCaseId,true);
        const sync=document.getElementById('desktop-last-sync');if(sync)sync.innerText=new Date().toLocaleString('zh-TW',{hour12:false});
        if(showFeedback)desktopFlashLiveBadge('已更新');
    }catch(err){console.error('Dashboard 更新失敗',err);desktopFlashLiveBadge('同步異常',true);}
}
function renderDesktopCaseLists(active,history,latestMap){
    document.getElementById('desktop-active-count').innerText=active.length;
    const activeEl=document.getElementById('desktop-active-list');
    activeEl.innerHTML=active.length?active.map(c=>{const latest=latestMap[c.id],unit=v17CaseUnitCode(c);return `<button onclick="openDesktopCase('${c.id}')" class="w-full text-left border rounded-xl p-3 transition ${desktopSelectedCaseId===c.id?'border-blue-500 bg-blue-50':'border-slate-200 hover:border-blue-300 bg-white'}"><div class="flex justify-between items-center gap-2"><span class="font-extrabold text-slate-900">${desktopProfile?.role==='admin'?escapeHtml(unit)+'｜':''}${escapeHtml(c.bed_no?c.bed_no+'床':'床號待補')}</span><span class="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-1 rounded-full">CPR中</span></div><div class="text-xs text-slate-500 mt-1">開始 ${formatDesktopDate(c.started_at)}</div><div class="text-sm mt-2 truncate ${latest?'text-slate-700':'text-slate-400'}">${latest?`最新：${escapeHtml(latest.action)}｜${escapeHtml(latest.detail||'')}`:'尚無處置紀錄'}</div></button>`}).join(''):'<div class="text-sm text-slate-400 text-center py-8">目前沒有進行中的 CPR</div>';
    const histEl=document.getElementById('desktop-history-list');
    histEl.innerHTML=history.length?history.map(c=>{const req=v18DeletionMap[c.id];const canRequest=desktopProfile?.role==='head_nurse'&&!req;return `<div class="v18-history-card ${desktopSelectedCaseId===c.id?'selected':''}"><button onclick="openDesktopCase('${c.id}')" class="w-full text-left"><div class="flex justify-between items-center gap-2"><span class="font-extrabold text-slate-800">${desktopProfile?.role==='admin'?escapeHtml(v17CaseUnitCode(c))+'｜':''}${escapeHtml(c.bed_no?c.bed_no+'床':'床號未填')}</span><span class="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full">已封存</span></div><div class="text-xs text-slate-500 mt-1">${formatDesktopDate(c.started_at)}</div><div class="text-[11px] text-slate-400 mt-1">${desktopCloseReason(c.close_reason)}</div></button>${desktopProfile?.role==='head_nurse'?`<div class="v18-history-actions">${req?v18StatusBadge(req.status):''}${canRequest?`<button onclick="openV18DeleteModal('${c.id}')" class="v18-small-btn v18-delete-btn"><i class="fa-solid fa-trash-can mr-1"></i>申請刪除</button>`:''}</div>`:''}</div>`}).join(''):'<div class="text-sm text-slate-400 text-center py-8">目前沒有歷史紀錄</div>';
}
function openV18DeleteModal(caseId){
    const c=desktopCases.find(x=>x.id===caseId);if(!c)return;
    v18DeleteCaseId=caseId;document.getElementById('v18-delete-case-meta').innerText=`${v17CaseUnitCode(c)}｜${c.bed_no?c.bed_no+'床':'床號未填'}｜開始 ${formatDesktopDate(c.started_at)}`;
    document.querySelector('input[name="v18-delete-reason"][value="test"]').checked=true;document.getElementById('v18-delete-other').value='';document.getElementById('v18-delete-other').classList.add('hidden');
    document.getElementById('v18-delete-modal').classList.remove('hidden');
}
function closeV18DeleteModal(){document.getElementById('v18-delete-modal').classList.add('hidden');v18DeleteCaseId=null;}
document.addEventListener('change',e=>{if(e.target?.name==='v18-delete-reason'){document.getElementById('v18-delete-other')?.classList.toggle('hidden',e.target.value!=='other');}});
async function submitV18DeleteRequest(btn){
    if(!v18DeleteCaseId)return;const reason=document.querySelector('input[name="v18-delete-reason"]:checked')?.value||'test',text=document.getElementById('v18-delete-other').value.trim();if(reason==='other'&&!text)return alertV17('請填寫其他刪除原因',true);
    setV17ButtonBusy(btn,true,'送出中...');try{const{error}=await supabaseClient.rpc('request_cpr_deletion',{p_case_id:v18DeleteCaseId,p_reason_code:reason,p_reason_text:text||null});if(error)throw error;closeV18DeleteModal();alertV17('刪除申請已送出，等待管理者審核');await refreshDesktopDashboard(false);}catch(e){alertV17(`送出失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}
}

// ---------- V18 護理長使用意見 ----------
async function loadHeadNurseFeedback(){
    const root=document.getElementById('head-nurse-feedback-content');if(!root)return;root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';
    const[tr,mr]=await Promise.all([supabaseClient.from('feedback_threads').select('*,units(code)').order('updated_at',{ascending:false}),supabaseClient.from('feedback_messages').select('*').order('created_at')]);
    if(tr.error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(tr.error.message)}</div>`;
    const msgs=mr.data||[];
    root.innerHTML=`<section class="v18-card p-5"><h3 class="font-extrabold text-lg mb-3">新增使用意見</h3><div class="v17-form-grid v17-grid-2"><div class="v17-field"><label class="v17-label">意見類型</label><select id="v18-feedback-category" class="v17-input"><option value="operation">操作問題</option><option value="feature">功能建議</option><option value="system">系統異常</option><option value="other">其他</option></select></div><div class="v17-field"><label class="v17-label">目前版本</label><input class="v17-input" value="V${CPRNOTE_APP_VERSION}" disabled></div></div><div class="v17-field mt-3"><label class="v17-label">意見內容</label><textarea id="v18-feedback-message" class="v18-textarea" placeholder="請說明您的問題或建議"></textarea></div><div class="v17-actions"><button onclick="submitV18Feedback(this)" class="v17-btn v17-btn-primary"><i class="fa-solid fa-paper-plane"></i>送出意見</button></div></section>${renderV18Threads(tr.data||[],msgs,false)}`;
}
async function submitV18Feedback(btn){const category=document.getElementById('v18-feedback-category').value,msg=document.getElementById('v18-feedback-message').value.trim();if(!msg)return alertV17('請輸入意見內容',true);setV17ButtonBusy(btn,true,'送出中...');try{const{data,error}=await supabaseClient.rpc('create_feedback_thread',{p_category:category,p_message:msg,p_app_version:`V${CPRNOTE_APP_VERSION}`});if(error)throw error;try{if(data)await invokeV17UserAdmin({action:'notify_admin_feedback',threadId:data});}catch(mailErr){console.warn('管理者 Email 通知失敗',mailErr);}alertV17('使用意見已送出');await loadHeadNurseFeedback();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}
function renderV18Threads(threads,msgs,isAdmin){
    if(!threads.length)return '<section class="v18-card p-5 text-center text-slate-400">目前沒有使用意見</section>';
    return `<div class="space-y-4">${threads.map(t=>{const tm=msgs.filter(m=>m.thread_id===t.id);return `<article class="v18-thread"><div class="v18-thread-head"><div><div class="font-extrabold text-slate-800">${isAdmin?`${escapeHtml(t.units?.code||'')}｜`:''}${escapeHtml(v18CategoryLabel(t.category))}</div><div class="text-xs text-slate-400 mt-1">提出版本 ${escapeHtml(t.app_version||'--')}｜建立 ${formatDesktopDate(t.created_at)}｜最後更新 ${formatDesktopDate(t.updated_at)}${t.completed_version?`｜完成版本 ${escapeHtml(t.completed_version)}`:''}</div></div>${v18StatusBadge(t.status)}</div><div class="v18-message-list">${tm.map(m=>`<div class="v18-message ${m.sender_role==='admin'?'admin':'mine'}"><div class="v18-message-meta">${escapeHtml(m.sender_name)}｜${formatDesktopDate(m.created_at)}</div>${escapeHtml(m.message)}</div>`).join('')}</div>${t.status!=='completed'?`<div class="v18-reply-row"><textarea id="v18-reply-${t.id}" class="v18-textarea" placeholder="輸入回覆內容"></textarea>${isAdmin?`<div class="flex flex-col gap-2 min-w-[150px]"><button onclick="replyV18Feedback('${t.id}','waiting_user',this)" class="v18-btn-primary">回覆</button><input id="v18-complete-version-${t.id}" class="v17-input text-sm" value="V${CPRNOTE_APP_VERSION}" placeholder="完成版本"><button onclick="completeV18Feedback('${t.id}',this)" class="v18-btn-success">完成</button></div>`:`<button onclick="replyV18Feedback('${t.id}','processing',this)" class="v18-btn-primary">送出回覆</button>`}</div>`:''}</article>`}).join('')}</div>`;
}
async function replyV18Feedback(threadId,status,btn){const el=document.getElementById(`v18-reply-${threadId}`),message=el?.value.trim();if(!message)return alertV17('請輸入回覆內容',true);setV17ButtonBusy(btn,true,'傳送中...');try{await invokeV17UserAdmin({action:'reply_feedback',threadId,message,status});alertV17('回覆已送出');desktopProfile.role==='admin'?await loadAdminFeedback():await loadHeadNurseFeedback();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}
function completeV18Feedback(threadId,btn){const message=document.getElementById(`v18-reply-${threadId}`)?.value.trim();const version=document.getElementById(`v18-complete-version-${threadId}`)?.value.trim();if(!message)return alertV17('完成前請在回覆框填寫完成說明',true);if(!version)return alertV17('請填寫完成版本',true);showActionToast({title:'完成使用意見',message:`完成版本：${escapeHtml(version)}。確認後會將完成說明寄 Email 給提出者。`,leftText:'取消',rightText:'確認完成',rightAction:()=>replyV18FeedbackComplete(threadId,message,version,btn)});}
async function replyV18FeedbackComplete(threadId,message,version,btn){setV17ButtonBusy(btn,true,'完成中...');try{await invokeV17UserAdmin({action:'reply_feedback',threadId,message,status:'completed',completedVersion:version});alertV17('已完成並寄送 Email 通知');await loadAdminFeedback();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}

// ---------- V18 管理者新頁面 ----------
function switchAdminSection(section){
    if(desktopProfile?.role!=='admin')return;v17AdminSection=section;const root=adminRoot();if(!root)return;
    document.querySelectorAll('.admin-section-btn').forEach(b=>{const a=b.dataset.adminSection===section;b.className=`admin-section-btn px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap ${a?'bg-blue-600 text-white':'bg-slate-100 text-slate-700'}`;});
    try{let task;if(section==='units')task=loadAdminUnits();else if(section==='headnurses')task=loadAdminHeadNurses();else if(section==='medications')task=loadAdminMedications();else if(section==='rhythms')task=loadAdminRhythms();else if(section==='tubes')task=loadAdminTubesBlood();else if(section==='deletions')task=loadAdminDeletionRequests();else if(section==='feedback')task=loadAdminFeedback();else if(section==='ratings')task=loadAdminRatings();else if(section==='audit')task=loadAdminAudit();else task=loadAdminUnits();Promise.resolve(task).catch(err=>{root.innerHTML=`<div class="bg-red-50 text-red-700 p-4 rounded-xl font-bold">讀取失敗：${escapeHtml(err?.message||String(err))}</div>`;});}catch(err){root.innerHTML=`<div class="bg-red-50 text-red-700 p-4 rounded-xl font-bold">讀取失敗：${escapeHtml(err?.message||String(err))}</div>`;}
}
async function loadAdminDeletionRequests(){
    const root=adminRoot();root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';
    const{data,error}=await supabaseClient.from('cpr_deletion_requests').select('*,units(code),profiles!cpr_deletion_requests_requested_by_fkey(display_name,username,contact_email),cpr_cases(bed_no,started_at)').order('created_at',{ascending:false});
    if(error){ // 若 FK 別名無法推導，改用分開查詢
        const rr=await supabaseClient.from('cpr_deletion_requests').select('*').order('created_at',{ascending:false});if(rr.error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(rr.error.message)}</div>`;return renderAdminDeletionFallback(rr.data||[]);
    }
    renderAdminDeletionRows(data||[]);
}
async function renderAdminDeletionFallback(rows){const root=adminRoot();const[ur,pr,cr]=await Promise.all([supabaseClient.from('units').select('id,code'),supabaseClient.from('profiles').select('user_id,display_name,username,contact_email'),supabaseClient.from('cpr_cases').select('id,bed_no,started_at')]);const um=Object.fromEntries((ur.data||[]).map(x=>[x.id,x])),pm=Object.fromEntries((pr.data||[]).map(x=>[x.user_id,x])),cm=Object.fromEntries((cr.data||[]).map(x=>[x.id,x]));renderAdminDeletionRows(rows.map(r=>({...r,units:um[r.unit_id],profiles:pm[r.requested_by],cpr_cases:cm[r.cpr_case_id]})));}
function renderAdminDeletionRows(rows){const root=adminRoot();const counts={pending:0,approved:0,rejected:0,completed:0};rows.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);root.innerHTML=`<div class="v18-kpis"><div class="v18-kpi"><div class="v18-kpi-label">待審核</div><div class="v18-kpi-value">${counts.pending}</div></div><div class="v18-kpi"><div class="v18-kpi-label">已核准待完成</div><div class="v18-kpi-value">${counts.approved}</div></div><div class="v18-kpi"><div class="v18-kpi-label">已拒絕</div><div class="v18-kpi-value">${counts.rejected}</div></div><div class="v18-kpi"><div class="v18-kpi-label">已完成</div><div class="v18-kpi-value">${counts.completed}</div></div></div><section class="v18-card p-5 mt-5"><h2 class="font-extrabold text-lg mb-3">CPR 紀錄刪除申請</h2><div class="space-y-3">${rows.length?rows.map(r=>`<div class="v17-subcard"><div class="flex justify-between gap-3 flex-wrap"><div><div class="font-extrabold text-slate-800">${escapeHtml(r.units?.code||'--')}｜${escapeHtml(r.cpr_cases?.bed_no?r.cpr_cases.bed_no+'床':'床號未填')}</div><div class="text-sm text-slate-500 mt-1">開始：${formatDesktopDate(r.cpr_cases?.started_at)}｜申請人：${escapeHtml(r.profiles?.display_name||r.profiles?.username||'--')}</div><div class="text-sm text-slate-600 mt-2">原因：${escapeHtml(v18ReasonLabel(r.reason_code,r.reason_text))}</div>${r.reject_reason?`<div class="text-sm text-red-600 mt-1">拒絕原因：${escapeHtml(r.reject_reason)}</div>`:''}<div class="text-xs text-slate-400 mt-1">申請 ${formatDesktopDate(r.created_at)}${r.completed_at?`｜完成 ${formatDesktopDate(r.completed_at)}`:''}</div></div><div class="flex items-start gap-2 flex-wrap">${v18StatusBadge(r.status)}${r.status==='pending'?`<button onclick="approveV18Delete('${r.id}',this)" class="v18-small-btn bg-emerald-600 text-white">通過</button><button onclick="rejectV18Delete('${r.id}',this)" class="v18-small-btn bg-red-600 text-white">拒絕</button>`:''}${r.status==='approved'?`<button onclick="completeV18Delete('${r.id}',this)" class="v18-small-btn bg-blue-600 text-white">完成刪除</button>`:''}</div></div></div>`).join(''):'<div class="text-center text-slate-400 py-8">目前沒有刪除申請</div>'}</div></section>`;}
async function approveV18Delete(id,btn){setV17ButtonBusy(btn,true,'處理中...');try{await invokeV17UserAdmin({action:'process_delete_request',requestId:id,decision:'approve'});alertV17('已核准，尚未刪除；請確認後再按「完成刪除」');await loadAdminDeletionRequests();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}
let v18RejectRequestId=null;
function rejectV18Delete(id,btn){v18RejectRequestId=id;document.getElementById('v18-reject-reason').value='';document.getElementById('v18-reject-modal').classList.remove('hidden');}
function closeV18RejectModal(){document.getElementById('v18-reject-modal').classList.add('hidden');v18RejectRequestId=null;}
async function confirmV18Reject(btn){const reason=document.getElementById('v18-reject-reason').value.trim();if(!reason)return alertV17('拒絕時必須填寫原因',true);const id=v18RejectRequestId;setV17ButtonBusy(btn,true,'處理中...');try{await invokeV17UserAdmin({action:'process_delete_request',requestId:id,decision:'reject',reason});closeV18RejectModal();alertV17('已拒絕並寄送 Email 通知');await loadAdminDeletionRequests();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}
function completeV18Delete(id,btn){showActionToast({title:'完成刪除',message:'確認後，這筆 CPR 將從一般歷史紀錄隱藏，稽核紀錄仍永久保留，並寄 Email 通知申請人。',leftText:'取消',rightText:'確認完成',danger:true,rightAction:()=>processV18Delete(id,'complete','',btn)});}
async function processV18Delete(id,decision,reason,btn){setV17ButtonBusy(btn,true,'處理中...');try{const res=await invokeV17UserAdmin({action:'process_delete_request',requestId:id,decision,reason});alertV17(decision==='reject'?'已拒絕並寄送 Email 通知':'刪除已完成並寄送 Email 通知');await loadAdminDeletionRequests();await refreshDesktopDashboard(false);}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}

async function loadAdminFeedback(){const root=adminRoot();root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';const[tr,mr,nr]=await Promise.all([supabaseClient.from('feedback_threads').select('*,units(code)').order('updated_at',{ascending:false}),supabaseClient.from('feedback_messages').select('*').order('created_at'),supabaseClient.from('notification_logs').select('*').in('notification_type',['feedback_reply','feedback_completed']).order('created_at',{ascending:false}).limit(30)]);if(tr.error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(tr.error.message)}</div>`;const threads=tr.data||[],counts={pending:0,processing:0,waiting_user:0,completed:0};threads.forEach(t=>counts[t.status]=(counts[t.status]||0)+1);root.innerHTML=`<div class="v18-kpis"><div class="v18-kpi"><div class="v18-kpi-label">待處理</div><div class="v18-kpi-value">${counts.pending}</div></div><div class="v18-kpi"><div class="v18-kpi-label">處理中</div><div class="v18-kpi-value">${counts.processing}</div></div><div class="v18-kpi"><div class="v18-kpi-label">等待使用者回覆</div><div class="v18-kpi-value">${counts.waiting_user}</div></div><div class="v18-kpi"><div class="v18-kpi-label">已完成</div><div class="v18-kpi-value">${counts.completed}</div></div></div><section class="mt-5">${renderV18Threads(threads,mr.data||[],true)}</section><section class="v18-card p-5 mt-5"><h3 class="font-extrabold mb-3">最近 Email 通知</h3>${renderV18Notifications(nr.data||[])}</section>`;}
function renderV18Notifications(list){if(!list.length)return '<div class="text-sm text-slate-400">尚無通知紀錄</div>';return `<div class="space-y-2">${list.map(n=>`<div class="flex justify-between gap-3 border-b border-slate-100 pb-2 text-sm"><div><b>${escapeHtml(n.subject||n.notification_type)}</b><div class="text-xs text-slate-400">${escapeHtml((n.recipient_email||'').replace(/^(.{2}).*(@.*)$/,'$1***$2'))}｜${formatDesktopDate(n.created_at)}</div>${n.error_message?`<div class="text-xs text-red-600">${escapeHtml(n.error_message)}</div>`:''}</div><span class="${n.status==='sent'?'text-emerald-600':'text-red-600'} font-bold">${n.status==='sent'?'寄送成功':'寄送失敗'}</span></div>`).join('')}</div>`;}

let v2AdminRatingsData=[];
function v2RenderAdminRatings(unitId=''){
    const area=document.getElementById('v2-rating-results');if(!area)return;
    const list=unitId?v2AdminRatingsData.filter(x=>String(x.unit_id)===String(unitId)):v2AdminRatingsData;
    const avg=list.length?(list.reduce((a,x)=>a+Number(x.rating||0),0)/list.length):0;
    const changed5=list.filter(x=>x.rating===5&&x.rating_changed).length;
    const default5=list.filter(x=>x.rating===5&&!x.rating_changed).length;
    area.innerHTML=`<div class="v18-kpis"><div class="v18-kpi"><div class="v18-kpi-label">平均滿意度</div><div class="v18-kpi-value">${avg.toFixed(1)} / 5</div></div><div class="v18-kpi"><div class="v18-kpi-label">回饋筆數</div><div class="v18-kpi-value">${list.length}</div></div><div class="v18-kpi"><div class="v18-kpi-label">主動選擇 5 星</div><div class="v18-kpi-value">${changed5}</div></div><div class="v18-kpi"><div class="v18-kpi-label">預設 5 星直接送出</div><div class="v18-kpi-value">${default5}</div></div></div><section class="v18-card p-5 mt-5"><h2 class="font-extrabold text-lg mb-3">CPR 使用體驗</h2><div class="space-y-2">${list.length?list.map(x=>`<div class="v17-subcard"><div class="flex justify-between gap-3 flex-wrap"><div><div class="font-extrabold">${'★'.repeat(x.rating)}${'☆'.repeat(5-x.rating)} <span class="text-sm text-slate-500">${x.rating}/5</span></div><div class="text-sm text-slate-600 mt-1">單位：${escapeHtml(x.units?.code||'--')}｜停止 CPR 員編：${escapeHtml(x.recorder_staff_no||'未填')}｜版本：${escapeHtml(x.app_version||'--')}</div>${x.comment?`<div class="text-sm text-slate-700 mt-2 bg-slate-50 rounded-lg p-2">${escapeHtml(x.comment)}</div>`:''}</div><div class="text-xs text-slate-400">${formatDesktopDate(x.submitted_at)}</div></div></div>`).join(''):'<div class="text-center text-slate-400 py-8">此範圍尚無使用體驗資料</div>'}</div></section>`;
}
async function loadAdminRatings(){
    const root=adminRoot();root.innerHTML='<div class="text-center text-slate-400 py-10">讀取中...</div>';
    const{data,error}=await supabaseClient.from('cpr_experience_ratings').select('*,units(code,name)').order('submitted_at',{ascending:false}).limit(1000);
    if(error)return root.innerHTML=`<div class="text-red-600">${escapeHtml(error.message)}</div>`;
    v2AdminRatingsData=data||[];
    const unitMap=new Map();v2AdminRatingsData.forEach(x=>{if(x.unit_id&&x.units?.code)unitMap.set(String(x.unit_id),x.units)});
    const opts=[...unitMap.entries()].sort((a,b)=>String(a[1].code).localeCompare(String(b[1].code))).map(([id,u])=>`<option value="${escapeHtml(id)}">${escapeHtml(u.code)}${u.name&&u.name!==u.code?`｜${escapeHtml(u.name)}`:''}</option>`).join('');
    root.innerHTML=`<section class="v18-card p-5"><div class="v2-rating-filter"><div class="v17-field"><label class="v17-label">查看單位</label><select id="v2-rating-unit-filter" class="v17-input" onchange="v2RenderAdminRatings(this.value)"><option value="">全部單位</option>${opts}</select></div><div class="text-sm text-slate-500 pb-3">可查看全院統計，或切換單一單位的使用體驗。</div></div></section><div id="v2-rating-results" class="mt-5"></div>`;
    v2RenderAdminRatings('');
}

function renderV18Stars(){const box=document.getElementById('v18-stars');if(!box)return;box.innerHTML=[1,2,3,4,5].map(i=>`<button type="button" class="v18-star ${i<=v18Rating?'':'off'}" onclick="setV18Rating(${i})">★</button>`).join('');document.getElementById('v18-rating-label').innerText=`${v18Rating} / 5`;}
function setV18Rating(n){v18Rating=n;v18RatingChanged=true;renderV18Stars();}
function openV18RatingModal(ctx){v18RatingContext=ctx;v18Rating=5;v18RatingChanged=false;document.getElementById('v18-rating-comment').value='';renderV18Stars();document.getElementById('v18-rating-modal').classList.remove('hidden');}
async function submitV18Rating(btn){if(!v18RatingContext?.caseId)return;setV17ButtonBusy(btn,true,'送出中...');try{const{error}=await supabaseClient.rpc('submit_cpr_experience',{p_case_id:v18RatingContext.caseId,p_rating:v18Rating,p_comment:document.getElementById('v18-rating-comment').value.trim()||null,p_rating_changed:v18RatingChanged,p_app_version:`V${CPRNOTE_APP_VERSION}`});if(error)throw error;document.getElementById('v18-rating-modal').classList.add('hidden');const bed=v18RatingContext.bed;v18RatingContext=null;resetForNewCPR();showToast(`本次 CPR 已完成並送出使用體驗${bed?`｜${bed}床`:''}`);}catch(e){alertV17(`使用體驗送出失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}}
async function confirmStopCPR(){
    if(!canEditCurrentCase())return;const bed=document.getElementById('stop-bed-input').value.trim(),nurse=document.getElementById('stop-nurse-input').value.trim();if(!bed)return showToast('請輸入床號',true);if(!nurse)return showToast('請輸入紀錄護理師員編',true);
    currentBed=bed;currentNurseId=nurse;cprEndedAtMs=Date.now();cprEndTime=new Date(cprEndedAtMs).toTimeString().substring(0,8);addLocalEvent('系統',`⛔ 停止急救｜${deviceUnit} ${currentBed}床｜紀錄護理師員編 ${currentNurseId}`,{kind:'stop_cpr'},false);
    isRunning=false;isTotalTimerRunning=false;clearInterval(timerInterval);stopCprAlarm();stopEpiAlarm();releaseWakeLock();cprTargetTimeMs=0;epiTargetTimeMs=0;
    const caseId=cloudCaseId||await startCloudCaseIfNeeded();await flushPendingEvents();if(caseId){try{const{error}=await supabaseClient.rpc('device_stop_cpr',{p_device_key:deviceId,p_case_id:caseId,p_bed_no:currentBed,p_recorder_staff_no:currentNurseId});if(error)throw error;setCloudStatus('synced');}catch(err){console.warn('停止急救將於網路恢復後補同步',err);queueFinalizationOp({type:'stopCase',cloudCaseId:caseId,bed:currentBed,nurse:currentNurseId,unsyncedEvents:events.filter(e=>!e.cloudId)});setCloudStatus(navigator.onLine?'pending':'offline','待同步');}}
    caseLocked=true;archiveCurrentCase('手動停止急救');closeModal();if(caseId)openV18RatingModal({caseId,bed:currentBed,nurse:currentNurseId,unit:deviceUnit});else{showToast('CPR 已封存，但目前無法建立評價資料；請確認網路後再測試',true);resetForNewCPR();}
}

// ---------- V18 Pump 標題兩行：欄位輸入框保持底部對齊 ----------
function renderHNMedCard(m,s={}){const epi=m.system_key==='epinephrine',visible=epi||s.is_visible!==false,quick=Array.isArray(s.quick_qty)?s.quick_qty.join(','):'1',globalPump=m.pump_default_value??0,hasOverride=s.pump_default_value_override!=null,pumpValue=hasOverride?s.pump_default_value_override:globalPump,sortValue=epi?1:(s.sort_order??m.global_sort??100),adminMode=isV17AdminUnitEditing();return `<div class="v17-subcard ${visible?'':'v177-card-off'}" data-v177-med="${m.id}" data-dirty="0"><div class="v17-status-line"><div><div class="flex items-center gap-2 flex-wrap"><span class="v17-sort-badge">${sortValue}</span><div class="font-extrabold text-slate-800">${escapeHtml(m.name)}</div>${epi?'<span class="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">固定第一</span>':''}</div><div class="text-xs text-slate-400 mt-1">${escapeHtml(m.generic_name||'')}${m.has_pump?`｜Pump ${m.pump_min_qty}支以上`:''}</div>${adminMode?`<div class="text-[11px] text-blue-600 mt-1">全院預設：${m.default_qty??1} 支${m.has_pump?`｜Pump ${globalPump} ${escapeHtml(m.pump_unit||'')}`:''}</div>`:''}</div>${renderV17Toggle(`hn-med-visible-${m.id}`,visible,'顯示',epi,epi?'':`onchange="v177ToggleCard(this,'med','${m.id}')"`)}</div><div class="v17-form-grid mt-3"><div class="v17-field"><div class="v18-pump-title"><label class="v17-label">預設支數</label></div><input id="hn-med-qty-${m.id}" type="number" step="0.5" class="v17-input" value="${s.default_qty??m.default_qty??1}"></div><div class="v17-field"><div class="v18-pump-title"><label class="v17-label">快速選擇（逗號分隔）</label></div><input id="hn-med-quick-${m.id}" class="v17-input" value="${escapeHtml(quick)}" placeholder="1,2,6"></div><div class="v17-field"><div class="v18-pump-title"><label class="v17-label">排序</label></div><input id="hn-med-sort-${m.id}" type="number" class="v17-input" value="${sortValue}" ${epi?'disabled':''}></div>${m.has_pump?`<div class="v17-field"><div class="v18-pump-title"><label class="v17-label">Pump 預設值（${escapeHtml(m.pump_unit||'滴/分')}）</label><button type="button" onclick="v177UseGlobalPump('${m.id}',${Number(globalPump)||0})" class="v18-pump-link">${hasOverride?'使用全院預設':'✓ 使用全院預設'} ${globalPump}</button></div><input id="hn-med-pump-${m.id}" data-pump-mode="${hasOverride?'override':'global'}" type="number" step="0.1" class="v17-input" value="${pumpValue}"></div>`:''}</div>${visible?'':'<div class="v177-off-note">目前不在 CPR 畫面顯示</div>'}</div>`;}

// ---------- V18 管理者：管路欄位改為可視化，不再編輯 JSON；同類別批次儲存 ----------
function v18FieldRows(t){const fields=Array.isArray(t.field_schema)?t.field_schema:[];return fields.map((f,i)=>`<div class="v18-field-schema" data-schema-row><input data-key value="${escapeHtml(f.key||'')}" placeholder="欄位代碼"><input data-label value="${escapeHtml(f.label||'')}" placeholder="顯示名稱"><select data-type><option value="text" ${f.type==='text'?'selected':''}>文字</option><option value="number" ${f.type==='number'?'selected':''}>數字</option></select><button type="button" onclick="this.closest('[data-schema-row]').remove();v18MarkAdminCard(this)" class="v18-remove-field"><i class="fa-solid fa-trash"></i></button></div>`).join('');}
function v18AddTubeField(id){const box=document.getElementById(`v18-tube-fields-${id}`);if(!box)return;const row=document.createElement('div');row.className='v18-field-schema';row.dataset.schemaRow='';row.innerHTML='<input data-key placeholder="欄位代碼，例如 depth_cm"><input data-label placeholder="顯示名稱，例如 固定深度(cm)"><select data-type><option value="text">文字</option><option value="number">數字</option></select><button type="button" class="v18-remove-field" onclick="this.closest(\'[data-schema-row]\').remove();v18MarkAdminCard(this)"><i class="fa-solid fa-trash"></i></button>';box.appendChild(row);v18MarkAdminCard(box);}
function v18MarkAdminCard(el){const card=el.closest?.('[data-v18-dirty]');if(card)card.dataset.v18Dirty='1';const c=document.getElementById('v18-admin-unsaved');if(c){const n=document.querySelectorAll('[data-v18-dirty="1"]').length;c.textContent=n?`${n} 項尚未儲存`:'已全部儲存';}}
async function loadAdminTubesBlood(){const root=adminRoot();const[tr,br]=await Promise.all([supabaseClient.from('tube_types').select('*').order('sort_order').order('name'),supabaseClient.from('blood_products').select('*').order('sort_order').order('name')]);const tubes=tr.data||[],blood=br.data||[];v17NextTubeSort=(tubes.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),0)||0)+1;v17NextBloodSort=(blood.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),0)||0)+1;root.innerHTML=`<section class="v17-card p-5"><h2 class="font-extrabold text-lg mb-3">新增管路類別</h2><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">代碼</label><input id="admin-tube-code" class="v17-input" placeholder="例如 aline"></div><div class="v17-field"><label class="v17-label">顯示名稱</label><input id="admin-tube-name" class="v17-input" placeholder="例如 A-line"></div><div class="v17-field"><label class="v17-label">排序</label><input id="admin-tube-sort" type="number" class="v17-input" value="${v17NextTubeSort}"></div><div class="v17-field"><button onclick="adminAddTube()" class="v17-btn v17-btn-primary w-full">＋ 新增管路</button></div></div></section><section class="v17-card p-5"><div class="v177-section-head"><div><h2 class="font-extrabold text-lg">管路主檔</h2><div id="v18-admin-unsaved" class="v18-unsaved">已全部儲存</div></div><button onclick="saveAllV18Tubes(this)" class="v17-btn v17-btn-primary">儲存管路設定</button></div><div class="v177-card-grid mt-3">${tubes.map(t=>`<div class="v17-subcard" data-v18-dirty="0" data-v18-tube="${t.id}"><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">名稱</label><input id="tube-name-${t.id}" class="v17-input" value="${escapeHtml(t.name)}"></div><div class="v17-field"><label class="v17-label">排序</label><input id="tube-sort-${t.id}" type="number" class="v17-input" value="${t.sort_order}"></div><div class="v17-field">${renderV17Toggle(`tube-active-${t.id}`,t.is_active,'啟用')}</div></div><div class="mt-3"><div class="flex justify-between items-center"><label class="v17-label">管路紀錄欄位</label><button onclick="v18AddTubeField('${t.id}')" class="v18-small-btn bg-blue-50 text-blue-700">＋ 新增欄位</button></div><div id="v18-tube-fields-${t.id}">${v18FieldRows(t)}</div></div></div>`).join('')}</div></section><section class="v17-card p-5"><div class="v177-section-head"><div><h2 class="font-extrabold text-lg">血品主檔</h2><div id="v18-blood-unsaved" class="v18-unsaved">已全部儲存</div></div><button onclick="saveAllV18Blood(this)" class="v17-btn v17-btn-primary">儲存血品設定</button></div><div class="v17-form-grid mt-3 mb-4"><div class="v17-field"><label class="v17-label">代碼</label><input id="admin-blood-code" class="v17-input"></div><div class="v17-field"><label class="v17-label">名稱</label><input id="admin-blood-name" class="v17-input"></div><div class="v17-field"><label class="v17-label">排序</label><input id="admin-blood-sort" type="number" class="v17-input" value="${v17NextBloodSort}"></div><div class="v17-field"><button onclick="adminAddBlood()" class="v17-btn v17-btn-danger w-full">＋ 新增血品</button></div></div><div class="v177-card-grid">${blood.map(b=>`<div class="v17-subcard" data-v18-dirty="0" data-v18-blood="${b.id}"><div class="v17-form-grid"><div class="v17-field"><label class="v17-label">名稱</label><input id="blood-name-${b.id}" class="v17-input" value="${escapeHtml(b.name)}"></div><div class="v17-field"><label class="v17-label">排序</label><input id="blood-sort-${b.id}" type="number" class="v17-input" value="${b.sort_order}"></div><div class="v17-field">${renderV17Toggle(`blood-active-${b.id}`,b.is_active,'啟用')}</div></div></div>`).join('')}</div></section>`;root.querySelectorAll('[data-v18-dirty] input,[data-v18-dirty] select').forEach(el=>{el.addEventListener('input',()=>v18MarkAdminCard(el));el.addEventListener('change',()=>v18MarkAdminCard(el));});}
async function saveAllV18Tubes(btn){const cards=[...document.querySelectorAll('[data-v18-tube][data-v18-dirty="1"]')];if(!cards.length)return alertV17('管路設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const card of cards){const id=card.dataset.v18Tube,rows=[...card.querySelectorAll('[data-schema-row]')],schema=rows.map(r=>({key:r.querySelector('[data-key]').value.trim(),label:r.querySelector('[data-label]').value.trim(),type:r.querySelector('[data-type]').value})).filter(x=>x.key&&x.label);const{error}=await supabaseClient.from('tube_types').update({name:document.getElementById(`tube-name-${id}`).value.trim(),sort_order:Number(document.getElementById(`tube-sort-${id}`).value)||100,is_active:document.getElementById(`tube-active-${id}`).checked,field_schema:schema}).eq('id',id);if(error)throw error;}alertV17(`管路設定已更新，共 ${cards.length} 項`);await loadAdminTubesBlood();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}
async function saveAllV18Blood(btn){const cards=[...document.querySelectorAll('[data-v18-blood][data-v18-dirty="1"]')];if(!cards.length)return alertV17('血品設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const card of cards){const id=card.dataset.v18Blood,{error}=await supabaseClient.from('blood_products').update({name:document.getElementById(`blood-name-${id}`).value.trim(),sort_order:Number(document.getElementById(`blood-sort-${id}`).value)||100,is_active:document.getElementById(`blood-active-${id}`).checked}).eq('id',id);if(error)throw error;}alertV17(`血品設定已更新，共 ${cards.length} 項`);await loadAdminTubesBlood();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}

// V18 啟動補強：確保新 Modal 星星渲染
setTimeout(()=>{renderV18Stars();},500);

// ---------- V18 管理者藥物／心律改為「同類別一次儲存」 ----------
const v18LegacyLoadAdminMedications = loadAdminMedications;
loadAdminMedications = async function(){
    await v18LegacyLoadAdminMedications();
    const root=adminRoot();if(!root)return;
    const sections=[...root.querySelectorAll('section')];
    const master=sections.find(s=>s.querySelector('h2')?.textContent.trim()==='藥物主檔');
    if(master){
        const h=master.querySelector('h2');const wrap=document.createElement('div');wrap.className='v177-section-head';
        const left=document.createElement('div');left.innerHTML='<h2 class="font-extrabold text-lg">藥物主檔</h2><div id="v18-admin-med-unsaved" class="v18-unsaved">已全部儲存</div>';
        const btn=document.createElement('button');btn.className='v17-btn v17-btn-primary';btn.innerHTML='<i class="fa-solid fa-floppy-disk"></i>儲存藥物設定';btn.onclick=()=>saveAllV18AdminMeds(btn);
        wrap.append(left,btn);h.replaceWith(wrap);
    }
    root.querySelectorAll('[id^="admin-med-"]').forEach(card=>{
        const id=card.id.replace('admin-med-','');if(id==='new')return;
        card.dataset.v18Dirty='0';card.dataset.v18AdminMed=id;
        card.querySelectorAll('.v17-actions button').forEach(b=>b.remove());
        card.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',()=>v18MarkAdminMed(card));el.addEventListener('change',()=>v18MarkAdminMed(card));});
    });
};
function v18MarkAdminMed(card){card.dataset.v18Dirty='1';const el=document.getElementById('v18-admin-med-unsaved');if(el){const n=document.querySelectorAll('[data-v18-admin-med][data-v18-dirty="1"]').length;el.textContent=n?`${n} 項尚未儲存`:'已全部儲存';}}
async function v18SaveAdminMedCard(card){
    const id=card.dataset.v18AdminMed,get=f=>card.querySelector(`[data-f="${f}"]`),hasPump=get('has_pump').checked;
    const payload={name:get('name').value.trim(),generic_name:get('generic_name').value.trim()||null,amount_value:Number(get('amount_value').value)||null,amount_unit:get('amount_unit').value.trim()||'mg',volume_ml:Number(get('volume_ml').value)||null,default_qty:Number(get('default_qty').value)||1,has_pump:hasPump,pump_min_qty:hasPump?(Number(get('pump_min_qty').value)||1):1,pump_default_value:hasPump?(Number(get('pump_default_value').value)||0):null,pump_unit:hasPump?(get('pump_unit').value.trim()||'滴/分'):'滴/分',is_active:get('is_active').checked,global_sort:Number(get('global_sort').value)||100,updated_at:new Date().toISOString()};
    if(!payload.name)throw new Error('藥物名稱必填');
    const{error}=await supabaseClient.from('medications').update(payload).eq('id',id);if(error)throw error;
    const mixEnabled=get('has_mix_ui')?.checked,sols=mixEnabled?[...card.querySelectorAll('[data-sol]:checked')].map(x=>x.dataset.sol):[],vols=mixEnabled?[...card.querySelectorAll('[data-vol]:checked')].map(x=>x.dataset.vol):[];
    const d1=await supabaseClient.from('medication_mix_solutions').delete().eq('medication_id',id);if(d1.error)throw d1.error;
    const d2=await supabaseClient.from('medication_mix_volumes').delete().eq('medication_id',id);if(d2.error)throw d2.error;
    if(sols.length){const r=await supabaseClient.from('medication_mix_solutions').insert(sols.map(solution_id=>({medication_id:id,solution_id})));if(r.error)throw r.error;}
    if(vols.length){const r=await supabaseClient.from('medication_mix_volumes').insert(vols.map(volume_id=>({medication_id:id,volume_id})));if(r.error)throw r.error;}
}
async function saveAllV18AdminMeds(btn){const cards=[...document.querySelectorAll('[data-v18-admin-med][data-v18-dirty="1"]')];if(!cards.length)return alertV17('藥物主檔沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const card of cards)await v18SaveAdminMedCard(card);alertV17(`藥物設定已更新，共 ${cards.length} 項`);await loadAdminMedications();}catch(e){alertV17(`儲存失敗：${e.message}`,true);}finally{setV17ButtonBusy(btn,false);}}

const v18LegacyLoadAdminRhythms = loadAdminRhythms;
loadAdminRhythms = async function(){
    await v18LegacyLoadAdminRhythms();const root=adminRoot();if(!root)return;
    const sections=[...root.querySelectorAll('section')];const sec=sections.find(s=>s.querySelector('h2')?.textContent.trim()==='心律');
    if(sec){const h=sec.querySelector('h2'),wrap=document.createElement('div');wrap.className='v177-section-head';wrap.innerHTML='<div><h2 class="font-extrabold text-lg">心律</h2><div id="v18-admin-rhythm-unsaved" class="v18-unsaved">已全部儲存</div></div>';const btn=document.createElement('button');btn.className='v17-btn v17-btn-primary';btn.textContent='儲存心律設定';btn.onclick=()=>saveAllV18Rhythms(btn);wrap.appendChild(btn);h.replaceWith(wrap);const list=sec.querySelector('.space-y-2');if(list)list.className='v177-card-grid';}
    root.querySelectorAll('input[id^="rh-name-"]').forEach(inp=>{const id=inp.id.replace('rh-name-',''),card=inp.closest('.v17-subcard');if(!card)return;card.dataset.v18Rhythm=id;card.dataset.v18Dirty='0';card.querySelectorAll('.v17-actions').forEach(x=>x.remove());card.querySelectorAll('input,select').forEach(el=>{const mark=()=>{card.dataset.v18Dirty='1';const n=document.querySelectorAll('[data-v18-rhythm][data-v18-dirty="1"]').length;const u=document.getElementById('v18-admin-rhythm-unsaved');if(u)u.textContent=n?`${n} 項尚未儲存`:'已全部儲存';};el.addEventListener('input',mark);el.addEventListener('change',mark);});});
};
async function saveAllV18Rhythms(btn){const cards=[...document.querySelectorAll('[data-v18-rhythm][data-v18-dirty="1"]')];if(!cards.length)return alertV17('心律設定沒有需要儲存的變更');setV17ButtonBusy(btn,true,'儲存中...');try{for(const c of cards){const id=c.dataset.v18Rhythm,{error}=await supabaseClient.from('rhythms').update({name:document.getElementById(`rh-name-${id}`).value.trim(),sort_order:Number(document.getElementById(`rh-sort-${id}`).value)||100,is_shockable:document.getElementById(`rh-shock-${id}`).checked,is_active:document.getElementById(`rh-active-${id}`).checked}).eq('id',id);if(error)throw error;}alertV17(`心律設定已更新，共 ${cards.length} 項`);await loadAdminRhythms();}catch(e){alertV17(e.message,true);}finally{setV17ButtonBusy(btn,false);}}


async function notifyV2AdminRatingComment(ratingId,comment){if(!ratingId||!comment)return;try{await invokeV17UserAdmin({action:'notify_admin_rating_comment',ratingId});}catch(e){console.warn('使用體驗 Email 通知失敗',e);}}
// ---------- V18 使用體驗離線補同步：必須按「送出」，但網路中斷不阻擋下一次急救 ----------
function v18PendingRatings(){try{return JSON.parse(localStorage.getItem('cpr_v18_pending_ratings')||'[]')}catch(e){return[]}}
function v18SavePendingRatings(list){localStorage.setItem('cpr_v18_pending_ratings',JSON.stringify(list));}
async function flushV18PendingRatings(){const list=v18PendingRatings();if(!list.length||!navigator.onLine)return;const remain=[];for(const x of list){try{const{data,error}=await supabaseClient.rpc('submit_cpr_experience',{p_case_id:x.caseId,p_rating:x.rating,p_comment:x.comment||null,p_rating_changed:!!x.ratingChanged,p_app_version:x.appVersion||`V${CPRNOTE_APP_VERSION}`});if(error)throw error;if(x.comment)await notifyV2AdminRatingComment(data,x.comment);}catch(e){remain.push(x);}}v18SavePendingRatings(remain);}
submitV18Rating = async function(btn){
    if(!v18RatingContext?.caseId)return;
    const payload={caseId:v18RatingContext.caseId,rating:v18Rating,comment:document.getElementById('v18-rating-comment').value.trim()||null,ratingChanged:v18RatingChanged,appVersion:`V${CPRNOTE_APP_VERSION}`};
    setV17ButtonBusy(btn,true,'送出中...');
    try{
        const{data,error}=await supabaseClient.rpc('submit_cpr_experience',{p_case_id:payload.caseId,p_rating:payload.rating,p_comment:payload.comment,p_rating_changed:payload.ratingChanged,p_app_version:payload.appVersion});
        if(error)throw error;
        if(payload.comment)await notifyV2AdminRatingComment(data,payload.comment);
        document.getElementById('v18-rating-modal').classList.add('hidden');const bed=v18RatingContext.bed;v18RatingContext=null;resetForNewCPR();showToast(`本次 CPR 已完成並送出使用體驗${bed?`｜${bed}床`:''}`);
    }catch(e){
        const list=v18PendingRatings();list.push(payload);v18SavePendingRatings(list);
        document.getElementById('v18-rating-modal').classList.add('hidden');const bed=v18RatingContext.bed;v18RatingContext=null;resetForNewCPR();showToast(`使用體驗已保存在此裝置，網路恢復後會自動補同步${bed?`｜${bed}床`:''}`);
    }finally{setV17ButtonBusy(btn,false);}
};
window.addEventListener('online',()=>setTimeout(flushV18PendingRatings,1500));
setTimeout(flushV18PendingRatings,2500);
