/**
 * Bounded UTF-8 HTTP request body reader.
 * On overflow, rejects with status 413 without destroying the socket so the
 * caller can write a clean HTTP 413 response with Connection: close.
 */
export function readRequestBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks = []
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        reject(Object.assign(new Error('Request body too large'), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}
