-- Isolated Mesen-2 joypad helpers. Override via MESEN capture script if the API differs.
-- See rhexec/devdocs/MESEN_CAPTURE.md

local function try_set_start(down)
  if emu.setInput then
    local ok = pcall(function()
      emu.setInput(0, { start = down, Start = down })
    end)
    if ok then return end
    pcall(function()
      -- bit 4 = Start on SNES
      local v = down and 0x10 or 0
      emu.setInput(0, v)
    end)
  end
end

function rh_set_start(down)
  try_set_start(down and true or false)
end
