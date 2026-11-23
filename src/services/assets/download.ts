// Stored ZIP entries avoid recompressing already compressed media. UTF-8 names
// and unique basenames make mixed-media exports portable without dependencies.
const encoder=new TextEncoder()
const crcTable=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);return crc>>>0})
export function safeAssetName(name:string) { return name.replace(/[\\/\u0000-\u001f<>:"|?*]/g,'_').replace(/^\.+/,'_').trim() || '素材' }
export async function assetZip(files:{ name:string; blob:Blob }[]):Promise<Blob> {
  if(files.length>65535)throw new Error('一次最多导出65535项素材')
  const chunks:BlobPart[]=[], central:BlobPart[]=[], names=new Set<string>();let offset=0,centralSize=0
  for(const file of files) {
    const original=safeAssetName(file.name);let filename=original, suffix=2
    while(names.has(filename)){const i=original.lastIndexOf('.');filename=i>0?`${original.slice(0,i)} (${suffix++})${original.slice(i)}`:`${original} (${suffix++})`}
    names.add(filename)
    const name=encoder.encode(filename), data=new Uint8Array(await file.blob.arrayBuffer())
    if(name.length>65535 || offset+data.length>0xffffffff)throw new Error('导出超过ZIP大小限制，请分批下载')
    let crc=0xffffffff
    for(const byte of data)crc=(crc>>>8)^crcTable[(crc^byte)&255];crc=(crc^0xffffffff)>>>0
    const h=new Uint8Array(30),v=new DataView(h.buffer)
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,0x21,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true)
    const c=new Uint8Array(46),w=new DataView(c.buffer)
    w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,0x21,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true)
    chunks.push(h,name,data);central.push(c,name);offset+=h.length+name.length+data.length;centralSize+=c.length+name.length
  }
  if(offset+centralSize>0xffffffff)throw new Error('导出过大，请分批下载')
  const end=new Uint8Array(22),v=new DataView(end.buffer)
  v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true)
  return new Blob([...chunks,...central,end],{type:'application/zip'})
}
export function downloadAssetBlob(blob:Blob,name:string) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safeAssetName(name);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)
}
