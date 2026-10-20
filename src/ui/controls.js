export function numberControl(container,{label,value,step=0.1,min=-100,max=100,key}) {
  const wrap=document.createElement('div');wrap.className='control';
  const l=document.createElement('label');l.textContent=label;
  const input=document.createElement('input');input.type='number';input.step=step;input.min=min;input.max=max;input.value=value;input.dataset.key=key;
  wrap.append(l,input);container.append(wrap);return input;
}
