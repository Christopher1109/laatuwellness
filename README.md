# Läätu 

OL

Actúa como un desarrollador/diseñador web senior. Vas a construir el sitio web (con miras a evolucionar a app) de Läätu Wellness, un estudio boutique de Pilates y wellness (incluye salón "Reformer", servicios de recuperación/contraste y bienestar integral). El diseño debe sentirse minimalista, nórdico, sereno y atemporal — nunca genérico ni "de plantilla".

1. IDENTIDAD DE MARCA (resumen del manual oficial)

Concepto: Läätu se basa en la "transformación consciente": el proceso de cambio de cada persona (del punto A al punto B) importa más que el destino. Vincula el ejercicio físico con la longevidad, la calma y la conexión mente-cuerpo. Estética inspirada en el minimalismo nórdico.

Personalidad de marca: serena, atemporal, profundamente conectada, omnipresente, honesta (sin pretensión). Empodera al usuario a encontrar paz en el caos y trazar su propio camino.

Tagline: "Wellness Recovery Bar"

Tono de voz / copywriting:

Bilingüe: inglés para precisión técnica (nombres de servicios, términos técnicos), español para textos informativos y de marca.
Dirigirse siempre al usuario en segunda persona ("tú"), en imperativo, tono empoderador.
Statements/afirmaciones en presente, que inviten a disfrutar y hacer una pausa.

Frases de marca (usar como acentos visuales, CTAs o textos de transición, NO todas juntas — dosificarlas):

"Vive el hoy, no el mañana."
"Abraza el caos, es tu mejor amigo."
"Encuentra paz en el caos."
"Ser flexible no es una debilidad."
"Ábrete a la posibilidad del camino."
"Abraza tu recorrido."
"Date un espacio para respirar."
"Agradece el recorrido."
"Aplaude tus tropiezos."
"Hay belleza en el caos."

Palabras clave para copy general: espacio, longevidad, conexión, respirar, disfrutar, trayectoria, recorrido, camino, pausa, wellness, transformación, proceso.

2. PALETA DE COLORES (oficial, no modificar)
Nombre	HEX	RGB	Uso recomendado
Shadow Blue	
#272838	39, 40, 56	Color principal / "negro funcional" de la marca. Texto principal, header, footer, botones primarios, fondos oscuros.
Stone Blue	
#8095A8	128, 149, 168	Color secundario. Acentos, botones secundarios, fondos medios, hover states.
Ivory	
#F9F8F2	249, 248, 242	Color base / fondo principal (off-white, NO blanco puro).

Combinaciones aprobadas: siempre mantener alto contraste (Shadow Blue sobre Ivory, Ivory sobre Shadow Blue/Stone Blue). No introducir colores fuera de esta paleta salvo estados funcionales mínimos (ej. error en formularios), que deben ser sutiles y no competir con la paleta.

3. TIPOGRAFÍA
Principal: Altone — sans serif geométrica grotesca, muy legible, con un toque bold. Úsala para títulos y jerarquía principal.
Secundaria: Nitti — sans serif robusta y moderna, aporta contraste. Úsala para cuerpo de texto, labels, UI.

Si Altone y Nitti no están disponibles como webfonts con licencia, usa estas alternativas de Google Fonts, y déjalo indicado en el código como comentario para reemplazo posterior:

Alternativa a Altone → "Archivo" o "Space Grotesk".
Alternativa a Nitti → "IBM Plex Sans" o "Public Sans".
4. LOGOTIPO (archivos adjuntos)

Se adjuntan dos versiones oficiales del logotipo principal ("LÄÄTU WELLNESS"):

logo-laatu-fondo-claro.jpg → wordmark en Shadow Blue sobre fondo Ivory. Usar en header/fondos claros.
logo-laatu-fondo-oscuro.jpg → wordmark en Ivory sobre fondo Stone Blue. Usar en footer/secciones oscuras/hero con overlay.

Reglas de uso (obligatorias): no estirar, distorsionar ni rotar el logo; respetar área de protección; no usar colores fuera de la paleta oficial; no reducir por debajo de proporción mínima (~2 x 0.6 cm equivalente).

5. ELEMENTOS GRÁFICOS
Ícono de marca: un ave figurativa estilo origami, construida con líneas y puntos — simboliza trayectos (A→B) y constelaciones (conexión entre partes de un proceso). Existen variantes en distintas posiciones para transmitir movimiento.
Patrones: patrones de puntos/líneas tipo "constelación" — úsalos con mucha sutileza como textura de fondo, separadores de sección, loaders o detalles decorativos.
Usa el ícono del ave como favicon / logo compacto en mobile.
6. ESTILO FOTOGRÁFICO

Blanco y negro, con grano ("grainy"), estética nostálgica, real y espontánea. Enfocado en el proceso (movimiento, esfuerzo, cuerpo en acción), no en poses forzadas. Para esta v1, usa fotografía de stock en blanco y negro con esta estética, dejando el código preparado para reemplazar cada imagen por fotos reales del estudio más adelante.

7. ESTRUCTURA DEL SITIO
Inicio — hero con logo, statement de marca, CTA a reservar/conocer programas.
Presentación / Nosotros — propuesta de valor: atención personalizada en salones íntimos (10 personas por salón).
Programas — salones (Reformer + segundo salón por definir) y servicios adicionales como módulos activables/desactivables: Nutrición, Psicología, Terapia de contraste (sauna infrarrojo).
Coaches — usar nombres ficticios para las instructoras en esta primera versión (para proteger horarios reales).
Horarios y reserva de clases — calendario/horario editable desde el panel admin.
Mi cuenta (nueva sección — ver punto 8) — login/registro, saldo de tokens, historial de reservas y compras.
App — sección/enlace "próximamente".
Redes — enlace a Instagram (@laatu) y a la línea de suplementos como enlace externo.
Panel administrativo para Lorena — editar horarios, activar/desactivar módulos, editar precios/paquetes, y (nuevo) ver y ajustar manualmente el saldo de tokens de cualquier usuario (ej. cortesías o correcciones).
8. CUENTAS DE USUARIO, AUTENTICACIÓN Y SISTEMA DE TOKENS (requisito clave)

El sitio necesita estar conectado a una base de datos real (tipo Supabase/Postgres) con un sistema completo de cuentas y créditos:

Autoregistro: los usuarios NO se crean manualmente por nosotros ni por Lorena. Cualquier persona crea su propia cuenta desde el sitio con correo y contraseña.
Login seguro: autenticación por correo/contraseña, contraseñas hasheadas (nunca en texto plano), sesión persistente, opción de "recuperar contraseña".
Perfil de usuario: nombre, correo, teléfono (opcional), estado de firma del waiver digital, historial de compras, historial de reservas, y saldo de tokens/créditos.
Compra de clases = compra de tokens: cuando un usuario compra un paquete (ej. paquete de 10 clases), se le acreditan tokens a su cuenta, ligados a su método de pago/tarjeta.
Reservar clase = consumir token: al reservar una clase con su nombre, el sistema descuenta automáticamente un token de su saldo. Si no tiene tokens suficientes, el sistema debe bloquear la reserva y dirigirlo a comprar más.
Vinculación con el waiver: el sistema debe verificar que el usuario tenga el waiver firmado (firma táctil) antes de permitirle reservar, sin importar si tiene tokens disponibles.
Historial visible para el usuario: tokens restantes, clases reservadas próximas, clases ya tomadas, compras realizadas.
Modelo de base de datos sugerido (tablas mínimas):
users (id, nombre, correo, contraseña hasheada, teléfono, waiver_firmado, fecha_registro)
packages / token_plans (id, nombre, cantidad_tokens, precio, recurrente sí/no)
transactions (id, user_id, package_id, monto, fecha, método de pago)
token_balance (user_id, tokens_disponibles) — o calculado a partir de transacciones/consumos
classes / schedule (id, salón, instructor_ficticio, fecha, hora, cupo_máximo)
bookings (id, user_id, class_id, tokens_consumidos, fecha_reserva, estado)
waiver_signatures (user_id, fecha_firma, firma_digital)
Seguridad: nunca exponer datos sensibles de otros usuarios; cada usuario solo ve su propia información desde su sesión.
Panel admin: debe poder ver todos los usuarios, su saldo de tokens, ajustar manualmente (sumar/restar tokens), y ver el historial de reservas por persona.
9. REQUISITOS TÉCNICOS Y DE NEGOCIO
Mobile-first y completamente responsive.
Sistema de pago/cobro recurrente para paquetes de tokens (tope de 30 personas en el paquete inicial).
Formulario de contacto / captación de leads.
Preparado para conectar a tuwellness.com como dominio (comprado en Namecheap; credenciales pendientes de la clienta).
Cuentas de correo con el dominio (formato tipo lore@tuwellness.com) para contacto.
Diseño modular: cada servicio, salón o paquete debe poder activarse/desactivarse sin rediseñar la página.
10. PENDIENTES / A CONFIRMAR CON LA CLIENTA
Documento Word con descripción final de paquetes, precios y reglas (incluye congelamiento y política de tokens no usados).
Excel de horarios actualizado (bloques 80% confirmados).
Texto legal final del waiver.
Nombre del segundo salón.
Fotos y videos definitivos del estudio.
Verificar el dominio final: el manual de marca especifica www.laatu.com, pero la reunión más reciente indica tuwellness.com. Confirmar con Lorena antes de configurar Namecheap.
Fecha objetivo de lanzamiento: 7 de septiembre. Video/anuncio en Instagram: 10 de septiembre.
11. LO QUE NO DEBE PASAR
No distorsionar/rotar el logo ni el ícono.
No usar colores fuera de la paleta (Shadow Blue / Stone Blue / Ivory).
No usar fotografía a color o de aspecto corporativo — mantener siempre blanco y negro con grano.
No sobrecargar el copy con todas las frases de marca al mismo tiempo.
No mostrar nombres reales de instructoras/horarios en esta primera versión.
No permitir reservas sin waiver firmado o sin tokens suficientes.
No crear cuentas de usuario manualmente — el registro siempre es autoservicio (correo + contraseña).

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://laatuwellness.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8470733c-8ea9-4761-b492-f88dd79f4206).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
