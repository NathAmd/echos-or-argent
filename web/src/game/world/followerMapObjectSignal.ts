/** État vivant du MapObject follower; il n'appartient jamais à la sauvegarde. */
export type FollowerMapObjectSignal = Readonly<{
  present: boolean
  visible: boolean
}>

export type FollowerMapObjectSignalReader = () => FollowerMapObjectSignal

const absentFollowerMapObjectSignal: FollowerMapObjectSignal = Object.freeze({
  present: false,
  visible: false,
})

export const readAbsentFollowerMapObjectSignal: FollowerMapObjectSignalReader = () => absentFollowerMapObjectSignal
