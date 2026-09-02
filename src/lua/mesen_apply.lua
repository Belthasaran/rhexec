-- Atomic Mesen restore: one cpuExec callback loads a throwaway .mss then returns.
-- MSS_PATH / WRAM_PATH injected by rhlaunch1-mesen. Do not spread writes across frames.

local applied = false
local exec_ref = nil

local function memtypes()
  local mt = emu.memType or {}
  return {
    wram = mt.snesWorkRam or mt.workRam or mt.snesMemory,
    vram = mt.snesVideoRam or mt.videoRam,
    cgram = mt.snesCgRam or mt.cgRam,
    oam = mt.snesSpriteRam or mt.spriteRam,
    sram = mt.snesSaveRam or mt.saveRam,
    -- spcRam is the 64KiB ARAM array. spcMemory is the SPC bus (IPL overlay
    -- at $FFC0); DebugWrite still lands in _ram, so it is a valid fallback.
    spc = mt.spcRam or mt.snesSpcRam,
    spc_bus = mt.spcMemory,
    dsp = mt.spcDspRegisters or mt.snesSpcDsp or mt.spcDsp,
    sa1_iram = mt.sa1InternalRam,
    gsu = mt.gsuWorkRam,
    cx4 = mt.cx4DataRam,
    dsp_data = mt.dspDataRam,
    st018 = mt.st018WorkRam,
    debug = mt.snesDebug or mt.snesMemory,
  }
end

local function read_all(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local blob = f:read("*a")
  f:close()
  return blob
end

local function write_region(path, mtype)
  if not path or not mtype or not emu.write then return false end
  local f = io.open(path, "rb")
  if not f then return false end
  local i = 0
  local use32 = emu.write32 ~= nil
  while true do
    if use32 then
      local b = f:read(4)
      if not b then break end
      if #b < 4 then
        for j = 1, #b do
          pcall(function() emu.write(i, string.byte(b, j), mtype) end)
          i = i + 1
        end
        break
      end
      local v = string.byte(b, 1) + string.byte(b, 2) * 256 + string.byte(b, 3) * 65536 + string.byte(b, 4) * 16777216
      local ok = pcall(function() emu.write32(i, v, mtype) end)
      if not ok then
        use32 = false
        for j = 1, 4 do
          pcall(function() emu.write(i, string.byte(b, j), mtype) end)
          i = i + 1
        end
      else
        i = i + 4
      end
    else
      local b = f:read(1)
      if not b then break end
      pcall(function() emu.write(i, string.byte(b), mtype) end)
      i = i + 1
    end
  end
  f:close()
  return true
end

-- Byte writes only. write32 pcall-success with a no-op leaves IPL/boot ARAM.
local function write_region_bytes(path, mtype)
  if not path or not mtype or not emu.write then return 0 end
  local f = io.open(path, "rb")
  if not f then return 0 end
  local wrote = 0
  local i = 0
  while true do
    local b = f:read(1)
    if not b then break end
    local ok = pcall(function() emu.write(i, string.byte(b), mtype) end)
    if ok then wrote = wrote + 1 end
    i = i + 1
  end
  f:close()
  return wrote
end

local function peek_file(path, addr)
  local f = io.open(path, "rb")
  if not f then return nil end
  f:seek("set", addr)
  local b = f:read(4)
  f:close()
  if not b or #b < 4 then return nil end
  return { string.byte(b, 1), string.byte(b, 2), string.byte(b, 3), string.byte(b, 4) }
end

local function peek_mem(mtype, addr)
  if not mtype or not emu.read then return nil end
  local out = {}
  for i = 0, 3 do
    local ok, v = pcall(function() return emu.read(addr + i, mtype) end)
    if not ok then return nil end
    out[i + 1] = v
  end
  return out
end

local function same4(a, b)
  if not a or not b then return false end
  return a[1] == b[1] and a[2] == b[2] and a[3] == b[3] and a[4] == b[4]
end

local function write_status(line)
  if not MSS_PATH then return end
  local path = MSS_PATH:gsub("[^/\\]+$", "apply_spc.txt")
  local f = io.open(path, "w")
  if not f then return end
  f:write(line)
  f:close()
end

-- Overlay ARAM and confirm a canary. Silent pcall failures used to leave IPL RAM.
local function overlay_spc()
  if not SPC_PATH then return false, "no-spc-path" end
  local mt = memtypes()
  local want = peek_file(SPC_PATH, 0x1015) or peek_file(SPC_PATH, 0)
  local types = { mt.spc, mt.spc_bus }
  local last = "no-type"
  for _, mtype in ipairs(types) do
    if mtype then
      write_region(SPC_PATH, mtype)
      local got = peek_mem(mtype, 0x1015) or peek_mem(mtype, 0)
      if want and same4(want, got) then
        return true, "ok"
      end
      write_region_bytes(SPC_PATH, mtype)
      got = peek_mem(mtype, 0x1015) or peek_mem(mtype, 0)
      if want and same4(want, got) then
        return true, "ok-bytes"
      end
      last = "canary-miss"
    end
  end
  return false, last
end

local function poke_dsp_flg()
  if not DSP_PATH then return end
  local mt = memtypes()
  if not mt.dsp then return end
  local f = io.open(DSP_PATH, "rb")
  if not f then return end
  f:seek("set", 0x6C)
  local b = f:read(1)
  f:close()
  if b then
    pcall(function() emu.write(0x6C, string.byte(b), mt.dsp) end)
  end
end

local function fallback_writes()
  local mt = memtypes()
  write_region(WRAM_PATH, mt.wram)
  if VRAM_PATH then write_region(VRAM_PATH, mt.vram) end
  if CGRAM_PATH then write_region(CGRAM_PATH, mt.cgram) end
  if OAM_PATH then write_region(OAM_PATH, mt.oam) end
  if SRAM_PATH then write_region(SRAM_PATH, mt.sram) end
  if DSP_PATH then write_region(DSP_PATH, mt.dsp) end
  if SA1_IRAM_PATH then write_region(SA1_IRAM_PATH, mt.sa1_iram) end
  if FILLRAM_PATH then write_region(FILLRAM_PATH, mt.debug) end
end

local function on_exec()
  if applied then return end
  applied = true
  local loaded = false
  if MSS_PATH and emu.loadSavestate then
    local blob = read_all(MSS_PATH)
    if blob then
      local ok, result = pcall(function() return emu.loadSavestate(blob) end)
      loaded = ok and result ~= false
    end
  end
  -- loadSavestate of a synthesized .mss can miss keys (Mesen keeps boot values).
  -- Always poke RAM + setState so CPU/PPU/HDMA/clocks match even if load fails
  -- or Lua's stringstream load is a no-op.
  if not loaded then
    fallback_writes()
  else
    local mt = memtypes()
    if WRAM_PATH then write_region(WRAM_PATH, mt.wram) end
    if SRAM_PATH then write_region(SRAM_PATH, mt.sram) end
  end
  local spc_ok, spc_why = overlay_spc()
  if SETSTATE and emu.setState then
    pcall(function() emu.setState(SETSTATE) end)
  end
  -- Captured spc.cycle is often a few thousand ticks ahead of
  -- masterClock*(sampleRate*64/clockRate). Spc::Run() then never executes.
  -- Snap just behind the scheduler (32000 Hz underestimates Mesen's +40 tweak).
  if emu.getState and emu.setState then
    local okst, st = pcall(emu.getState)
    if okst and type(st) == "table" then
      local master = st["memoryManager.masterClock"] or st["masterClock"]
      local rate = st["clockRate"]
      if type(master) == "number" and type(rate) == "number" and rate > 0 then
        local target = math.floor(master * (32000 * 64) / rate) - 64
        if target < 0 then target = 0 end
        pcall(function() emu.setState({ ["spc.cycle"] = target }) end)
      end
    end
  end
  -- setState cannot write ARAM (Map format skips large arrays). Re-check
  -- after register restore; only rewrite if the canary slipped.
  local spc_ok2, spc_why2 = spc_ok, "skip"
  do
    local mt = memtypes()
    local want = SPC_PATH and (peek_file(SPC_PATH, 0x1015) or peek_file(SPC_PATH, 0))
    local got = peek_mem(mt.spc or mt.spc_bus, 0x1015) or peek_mem(mt.spc or mt.spc_bus, 0)
    if not (want and same4(want, got)) then
      spc_ok2, spc_why2 = overlay_spc()
    else
      spc_ok2, spc_why2 = true, "still-ok"
    end
  end
  if not loaded then
    local mt = memtypes()
    if DSP_PATH then write_region(DSP_PATH, mt.dsp) end
  else
    poke_dsp_flg()
  end
  write_status(string.format("loaded=%s spc=%s/%s why=%s/%s\n",
    tostring(loaded), tostring(spc_ok), tostring(spc_ok2), tostring(spc_why), tostring(spc_why2)))
  -- Lua loadSavestate does not run StateLoaded, so uninit-read tracking stays
  -- at power-on. After masterClock is restored, reset so Mesen stops logging
  -- every WRAM read as uninitialized.
  if emu.resetAccessCounters then pcall(emu.resetAccessCounters) end
  if emu.displayMessage then
    local msg = loaded and "state loaded" or "state fallback"
    if not (spc_ok or spc_ok2) then msg = msg .. " (spc aram fail)" end
    pcall(function() emu.displayMessage("rhexec", msg) end)
  end
  if exec_ref and emu.removeMemoryCallback then
    pcall(function() emu.removeMemoryCallback(exec_ref) end)
  end
  if emu.resume then pcall(emu.resume) end
end

local cb = (emu.callbackType and emu.callbackType.exec) or 2
if emu.addMemoryCallback then
  local ok, ref = pcall(function()
    return emu.addMemoryCallback(on_exec, cb, 0, 0xFFFFFF)
  end)
  if ok then exec_ref = ref end
end
