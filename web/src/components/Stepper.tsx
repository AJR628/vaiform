export function Stepper({ steps, current }:{ steps:string[]; current:number }){
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map((s,i)=> (
        <div key={s} className={`px-2 py-1 rounded ${i===current?'bg-blue-600':'bg-neutral-800'}`}>{s}</div>
      ))}
    </div>
  )
}


