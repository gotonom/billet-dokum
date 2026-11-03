// Plant-model checks over several simulated days: phase sync between units, mass balance,
// chemistry in spec, homogenising limits, daily totals that never drop. Run: node test/model_check.js
global.document={addEventListener(){},documentElement:{dataset:{}},querySelector(){return null},querySelectorAll(){return []}};
global.sessionStorage={getItem(){return null},setItem(){}};global.localStorage=sessionStorage;global.window={};
eval(require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../src/common.js'),'utf8')+';Object.assign(global,{PLANT,castInfo,table,melter,holder,homog,cooler,buffer,saw,doneCasts,profile,pouredToday,shippedToday,GAS,fitsAlloy,correction,STAGES,castStage})');
const fail=[]; const ok=(c,m)=>{if(!c)fail.push(m)};
for (const a of ['6063','6060','6082']) { const p=profile(a); console.log(a,'döküm',p.tEnd.toFixed(1),'dk; boşaltmaya kalan',(PLANT.UNLOAD_END-40-p.tTaper).toFixed(1),'dk'); ok(PLANT.UNLOAD_END-40-p.tTaper>=PLANT.TILT_MIN+12,'unload too short '+a); }
let prevPour=0, prevDay=-1, maxPit=0;
for(let T=-1440;T<4320;T+=.25){
  const tb=table(T), b=holder(T), e=[melter(0,T),melter(1,T)], H=[0,1,2,3,4].map(k=>homog(k,T));
  for(const x of [tb.L,b.mass,e[0].mass,e[1].mass,tb.water]) ok(isFinite(x)&&x>=0,'bad num T='+T);
  ok(b.mass>=PLANT.HEEL_DRAIN-0.01 && b.mass<=PLANT.HEEL_B+tb.cast.transfer+40,'B1 mass '+b.mass+' T='+T);
  e.forEach(m=>ok(m.mass>=PLANT.HEEL_DRAIN-0.05,'E heel '+m.mass.toFixed(2)+' '+m.phase+' T='+T));
  if(b.phase==='DÖKÜM') ok(tb.metal || tb.phase==='BİTİŞ','B1 pours, table '+tb.phase+' T='+T);
  if(tb.metal) ok(b.phase==='DÖKÜM','table metal but B1 '+b.phase+' T='+T);
  e.forEach(m=>{ if(m.phase==='TRANSFER') ok(b.phase==='DOLUM','transfer while B1 '+b.phase+' T='+T); });
  ok(H.filter(h=>h.phase==='YÜKLEME').length<=1,'two loadings T='+T);
  if(tb.phase==='BOŞALTMA') ok(tb.unload<=1,'unload');
  // table phases contiguous
  for(let i=1;i<tb.phases.length;i++) ok(Math.abs(tb.phases[i].start-tb.phases[i-1].end)<1e-9,'gap table phases');
  // poured today monotonic within a day
  const d=Math.floor(T/1440), p=pouredToday(T); if(d===prevDay) ok(p>=prevPour-1e-6,'poured drops T='+T+' '+prevPour.toFixed(1)+'→'+p.toFixed(1)); prevDay=d; prevPour=p;
}
// shipped today monotonic + end of day value
let prevS=0; for(let T=1440;T<2880;T+=1){const s=shippedToday(T).total; ok(s>=prevS-1e-6,'shipped drops '+T); prevS=s;}
console.log('gün sonu sevk',prevS.toFixed(1),'t, partiler',shippedToday(2879.9).batches);
// last cast unloaded fully: at UNLOAD_END-1 unload==1
for(const n of [0,4]){const t=table(n*144+PLANT.UNLOAD_END-0.5); ok(t.unload>=0.99,'not fully unloaded n='+n+' '+t.unload.toFixed(2));}
// chemistry: b1chem in spec for all casts, including alloy changes
let corr=0; for(let n=0;n<60;n++){const c=castInfo(n), s=PLANT.ALLOYS[c.alloy].spec; if(c.corr)corr++; for(const el in s){ ok(c.b1chem[el]>=s[el][0]-1e-9&&c.b1chem[el]<=s[el][1]+1e-9,'B1 chem out '+c.id+' '+c.alloy+' '+el+' '+c.b1chem[el]); }
  for (const el of ['Si','Mg']) { const tol=Math.max(.015,(s[el][1]-s[el][0])*.05); if(Math.abs(c.b1chem[el]-s[el][2])>tol+0.006) console.log('pencere dışı B1',c.id,c.alloy,'←',c.heelAlloyB,el,c.b1chem[el],'hedef',s[el][2]); } }
console.log('düzeltme gereken döküm',corr,'/60');
// homogenising: soak hours per alloy before unload, max air vs solidus
for(const n of [0,4]){const k=n%5, h=homog(k,n*144+PLANT.UNLOAD_END+619); console.log('H',h.alloy,'bekletme',(h.soak/60).toFixed(2),'sa; metal',h.metal.toFixed(0)); let mx=0; for(let L=0;L<640;L++){mx=Math.max(mx,homog(k,n*144+PLANT.UNLOAD_END+L).air)} console.log('  maks hava',mx.toFixed(0),'(sınır',PLANT.ALLOYS[h.alloy].airMax,')'); ok(mx<=PLANT.ALLOYS[h.alloy].airMax+3,'air over '+h.alloy)}
// gas
let dg=0,dn=0; for(let n=10;n<20;n++){dg+=castInfo(n).gross;dn+=castInfo(n).net}
console.log('gaz/döküm Nm³: ergitme',GAS.e.toFixed(0),'B1',GAS.b.toFixed(0),'homojen',GAS.h.toFixed(0),'→',(GAS.e/ (dg/10)).toFixed(1),'+',(GAS.h/(dg/10)).toFixed(1),'Nm³/t brüt; KPI',castInfo(12).gas.toFixed(1),'Nm³/t net');
const c=castInfo(12); console.log('kütle: şarj',c.charge.toFixed(2),'transfer',c.transfer.toFixed(2),'brüt',c.gross.toFixed(2),'net',c.net.toFixed(2),'| ergitme kaybı %',c.meltLoss.toFixed(2),'döküm verimi %',c.castYield.toFixed(1));
const sw=saw(PLANT.SAW_AT+5); console.log('UT girişinde log sıcaklığı',sw.logTemp.toFixed(0),'°C; yolculuk',(PLANT.JOURNEY/60).toFixed(1),'sa');
console.log('fitsAlloy 6063 Fe0.40 → 6082?', fitsAlloy('6082',{Si:.43,Fe:.40,Cu:.02,Mn:.03,Mg:.5,Cr:.01,Zn:.02,Ti:.02}));
const r=correction('6063',{Si:.62,Fe:.2,Cu:.02,Mn:.03,Mg:.46,Cr:.01,Zn:.02,Ti:.02},36000); console.log('Si .62: seyreltme',(r.dilute.primer/1000).toFixed(1),'t; sonra',r.dilute.after.adds.map(a=>a.el+' '+a.kg.toFixed(0)+'kg').join(','));
console.log(fail.length?('HATA '+fail.length+': '+[...new Set(fail.map(f=>f.replace(/T=.*$/,'')))].slice(0,12).join(' | ')+' örn: '+fail[0]):'TÜM KONTROLLER GEÇTİ');
// furnaces end each cycle on their normal heel
for(let n=0;n<20;n++){ const T=n*144+18-0.01; const k=n%2; const m=melter(k,T); ok(Math.abs(m.mass-PLANT.HEEL_E)<0.05,'E end heel '+m.mass.toFixed(2)+' n='+n); const b=holder(n*144+40+castInfo(n).prof.tEnd+0.5); ok(Math.abs(b.mass-PLANT.HEEL_B)<0.05,'B1 end heel '+b.mass.toFixed(2)+' n='+n); }
console.log(fail.length?'HATA2 '+fail.slice(-5).join(' | '):'KÜTLE DENGESİ GEÇTİ');
