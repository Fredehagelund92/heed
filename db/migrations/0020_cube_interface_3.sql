-- 0020_cube_interface_3: Cube is a connector written to interface 3.0 (docs/connectors.md).
--
-- A source records the interface its connector was written to. Cube was written to interface 2
-- and read through an adapter; it is now a connector of its own, with the same settings and the
-- same refs, so the sources an administrator added keep reading as they did. The server's own
-- Cube source records the new interface at its next read.

update public.connectors set interface_version = 3 where type = 'cube' and interface_version = 2;
