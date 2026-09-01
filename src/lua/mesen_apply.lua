-- Apply mutated WRAM (and CPU if possible) then let the game run.
-- WRAM_PATH / CPU_PATH injected by rhlaunch1-mesen.

local applied = false

local function memtypes()
  local mt = emu.memType or {}
  return mt.snesWorkRam or mt.workRam or mt.snesMemory
end

local function on_frame()
  if applied then return end
  applied = true
  local mtype = memtypes()
  local f = io.open(WRAM_PATH, "rb")
  if f and mtype and emu.write then
    local i = 0
    while true do
      local b = f:read(1)
      if not b then break end
      pcall(function()
        emu.write(i, string.byte(b), mtype)
      end)
      i = i + 1
    end
    f:close()
  end
  if emu.displayMessage then
    pcall(function() emu.displayMessage("rhexec", "WRAM applied") end)
  end
end

if emu.addEventCallback and emu.eventType then
  emu.addEventCallback(on_frame, emu.eventType.startFrame or 0)
elseif emu.addEventCallback then
  emu.addEventCallback(on_frame, 0)
end
