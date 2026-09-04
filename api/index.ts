export default async function handler(req: any, res: any) {
  res.status(200).json({ ping: "ok", time: Date.now(), url: req.url })
}