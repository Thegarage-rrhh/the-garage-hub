-- =====================================================================
--  THE GARAGE HUB · Clasificar el catálogo entre Servicio y Producto
--  Al importar del Excel todo quedó como "Servicio".
--  Supabase > SQL Editor > New query > pegar todo > Run
-- =====================================================================

-- Los tapetes se fabrican y se venden: son productos
update public.catalogo set tipo = 'Producto'
 where categoria in ('Tapetes', 'Llaveros');

-- Lo demás es mano de obra sobre el vehículo: son servicios
update public.catalogo set tipo = 'Servicio'
 where categoria in ('Detailing', 'Tapicería', 'Forros', 'Polarizado', 'PPF');

-- Cómo quedó
select tipo, categoria, count(*) as cantidad
  from public.catalogo
 group by tipo, categoria
 order by tipo, categoria;
