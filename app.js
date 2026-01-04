function addItem(list, name){
  const item=document.createElement('div');
  item.className='item';
  const n=document.createElement('div');
  n.className='name';
  n.textContent=name;
  const t=document.createElement('div');
  t.className='time';
  let sec=0;
  setInterval(()=>{
    sec++;
    const m=String(Math.floor(sec/60)).padStart(2,'0');
    const s=String(sec%60).padStart(2,'0');
    t.textContent=`00:${m}:${s}`;
  },1000);
  const b=document.createElement('div');
  b.className='btn';
  b.textContent='대기';
  item.append(n,t,b);
  list.appendChild(item);
}
addItem(document.getElementById('waitList'),'종욱');
addItem(document.getElementById('assignedList'),'지환');
