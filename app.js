const waitList = document.getElementById("waitList");
const addBtn = document.getElementById("addWait");
const input = document.getElementById("waitName");

let state = [];

addBtn.onclick = () => {
  const name = input.value.trim();
  if(!name) return;
  state.push({ id: Date.now(), name });
  input.value = "";
  render();
};

function render(){
  waitList.innerHTML = "";
  state.forEach(p => {
    const item = document.createElement("div");
    item.className = "item";

    const nameEl = document.createElement("div");
    nameEl.textContent = p.name;

    const del = document.createElement("button");
    del.className = "itemBtn";
    del.textContent = "삭제";
    del.onclick = () => {
      state = state.filter(x => x.id !== p.id);
      render();
    };

    item.appendChild(nameEl);
    item.appendChild(del);
    waitList.appendChild(item);
  });
}
