import React from 'react';
import { StyleSheet, View } from 'react-native';

export function ProgressBar({ value }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${clamped}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#1e293b',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#38bdf8',
  },
});
