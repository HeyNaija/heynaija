/** Hands the browser a JSON file to save, made on the page: nothing is sent anywhere. */
export function saveJsonFile(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers read the file after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
