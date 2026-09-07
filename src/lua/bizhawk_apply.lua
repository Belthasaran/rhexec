-- rhstate1-bizhawk: poke then savestate.save and exit.
-- Preamble also sets OUT_PATH.

if not OUT_PATH then
  error("rhstate1-bizhawk: OUT_PATH is not set")
end
savestate.save(OUT_PATH)
print("rhstate1-bizhawk: saved " .. OUT_PATH)
client.exit()
