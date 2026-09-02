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
    spc = mt.spcRam or mt.snesSpcRam,
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

local function fallback_writes()
  local mt = memtypes()
  write_region(WRAM_PATH, mt.wram)
  if VRAM_PATH then write_region(VRAM_PATH, mt.vram) end
  if CGRAM_PATH then write_region(CGRAM_PATH, mt.cgram) end
  if OAM_PATH then write_region(OAM_PATH, mt.oam) end
  if SRAM_PATH then write_region(SRAM_PATH, mt.sram) end
  if SPC_PATH then write_region(SPC_PATH, mt.spc) end
  if DSP_PATH then write_region(DSP_PATH, mt.dsp) end
  if SA1_IRAM_PATH then write_region(SA1_IRAM_PATH, mt.sa1_iram) end
  if FILLRAM_PATH then write_region(FILLRAM_PATH, mt.debug) end
  if CPU_PATH and emu.setState then
    local raw = read_all(CPU_PATH)
    if raw and emu.getState then
      local ok, st = pcall(emu.getState)
      if ok and type(st) == "table" then
        -- cpu.json is portable; leave setState to Node-synth MSS path
      end
    end
  end
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
    -- Lua memType.spcDspRegisters is ExternalRegs; mixer uses Regs from the MSS.
    if SPC_PATH then write_region(SPC_PATH, mt.spc) end
    if DSP_PATH then write_region(DSP_PATH, mt.dsp) end
    if SRAM_PATH then write_region(SRAM_PATH, mt.sram) end
  end
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
  -- Lua spcDspRegisters writes go through Dsp::Write (Regs + ExternalRegs + KON).
  if DSP_PATH then
    local mt = memtypes()
    write_region(DSP_PATH, mt.dsp)
  end
  -- Lua loadSavestate does not run StateLoaded, so uninit-read tracking stays
  -- at power-on. After masterClock is restored, reset so Mesen stops logging
  -- every WRAM read as uninitialized.
  if emu.resetAccessCounters then pcall(emu.resetAccessCounters) end
  if emu.displayMessage then
    pcall(function() emu.displayMessage("rhexec", loaded and "state loaded" or "state fallback") end)
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
