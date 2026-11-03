import type { Metadata, Viewport } from "next";
import "./styles.css";
export const metadata: Metadata = {applicationName:"Cash Control",title:"Cash Control · BRANLY RUIZ",description:"Control personal de ingresos, gastos y deudas",manifest:"/manifest.webmanifest",icons:{icon:[{url:"/icon.svg",type:"image/svg+xml"}],apple:[{url:"/icon.svg",type:"image/svg+xml"}]},appleWebApp:{capable:true,title:"Cash Control",statusBarStyle:"default"},robots:{index:false,follow:false}};
export const viewport: Viewport = {width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#121a2b"};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="es"><body>{children}</body></html>}
